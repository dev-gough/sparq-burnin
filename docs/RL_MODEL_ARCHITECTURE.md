# RL Model Architecture

## Overview

This document specifies the neural network architectures for the model-based RL system, including:
1. **Forward Dynamics Model** - Predicts future state given current state and action
2. **Policy Network (Actor)** - Selects actions to minimize export
3. **Value Networks (Critics)** - Estimates action quality for training

**Framework:** PyTorch
**RL Algorithm:** Soft Actor-Critic (SAC) with Conservative Q-Learning (CQL)

---

## 1. Forward Dynamics Model

**Purpose:** Learn `f(state_t, action_t) → state_{t+k}` to handle multi-second delay

### Architecture

```python
import torch
import torch.nn as nn

class ForwardDynamicsModel(nn.Module):
    """
    Predicts future state given current state and action.

    Handles multi-second delay by predicting state k seconds in future.
    """

    def __init__(
        self,
        state_dim: int = 30,      # Number of state features
        action_dim: int = 3,       # Number of action dimensions (per-phase power)
        hidden_dim: int = 256,
        lstm_hidden: int = 128,
        num_lstm_layers: int = 2,
        lookahead_steps: int = 5   # Predict 5 seconds ahead
    ):
        super().__init__()

        self.state_dim = state_dim
        self.action_dim = action_dim
        self.lookahead_steps = lookahead_steps

        # Input encoder
        self.encoder = nn.Sequential(
            nn.Linear(state_dim + action_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.LayerNorm(hidden_dim // 2),
            nn.ReLU()
        )

        # LSTM for temporal dynamics
        self.lstm = nn.LSTM(
            input_size=hidden_dim // 2,
            hidden_size=lstm_hidden,
            num_layers=num_lstm_layers,
            batch_first=True,
            dropout=0.1 if num_lstm_layers > 1 else 0
        )

        # Output predictor (predicts delta, not absolute state)
        self.predictor = nn.Sequential(
            nn.Linear(lstm_hidden, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, state_dim)
        )

    def forward(self, state, action):
        """
        Args:
            state: [batch, state_dim]
            action: [batch, action_dim]

        Returns:
            next_state: [batch, state_dim] - predicted state after lookahead_steps
        """
        # Concatenate state and action
        x = torch.cat([state, action], dim=-1)  # [batch, state_dim + action_dim]

        # Encode
        encoded = self.encoder(x)  # [batch, hidden_dim // 2]

        # LSTM (add sequence dimension)
        encoded = encoded.unsqueeze(1)  # [batch, 1, hidden_dim // 2]
        lstm_out, _ = self.lstm(encoded)  # [batch, 1, lstm_hidden]
        lstm_out = lstm_out.squeeze(1)  # [batch, lstm_hidden]

        # Predict delta state
        delta_state = self.predictor(lstm_out)  # [batch, state_dim]

        # Residual connection (predict change, not absolute)
        next_state = state + delta_state

        return next_state

    def predict_trajectory(self, state, actions):
        """
        Predict multi-step trajectory.

        Args:
            state: [batch, state_dim] - initial state
            actions: [batch, horizon, action_dim] - sequence of actions

        Returns:
            states: [batch, horizon, state_dim] - predicted state trajectory
        """
        batch_size, horizon, _ = actions.shape
        states = []

        current_state = state
        for t in range(horizon):
            next_state = self.forward(current_state, actions[:, t, :])
            states.append(next_state)
            current_state = next_state

        return torch.stack(states, dim=1)  # [batch, horizon, state_dim]


class ForwardModelLoss(nn.Module):
    """Custom loss for training forward dynamics model"""

    def __init__(self, weighted=True):
        super().__init__()
        self.weighted = weighted

    def forward(self, pred_state, true_state):
        """
        Args:
            pred_state: [batch, state_dim]
            true_state: [batch, state_dim]
        """
        # MSE loss
        mse = (pred_state - true_state) ** 2

        if self.weighted:
            # Weight more important features (e.g., export power) more heavily
            weights = torch.ones_like(mse)
            weights[:, 0] = 5.0  # Export power (most important)
            weights[:, 1:4] = 3.0  # Per-phase power
            mse = mse * weights

        return mse.mean()
```

### Training Procedure

```python
def train_forward_model(model, train_loader, val_loader, epochs=100):
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5)
    criterion = ForwardModelLoss(weighted=True)

    best_val_loss = float('inf')

    for epoch in range(epochs):
        # Training
        model.train()
        train_losses = []

        for batch in train_loader:
            state = batch['state']
            action = batch['action']
            next_state = batch['next_state']

            # Forward pass
            pred_next_state = model(state, action)
            loss = criterion(pred_next_state, next_state)

            # Backward pass
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            train_losses.append(loss.item())

        # Validation
        model.eval()
        val_losses = []

        with torch.no_grad():
            for batch in val_loader:
                state = batch['state']
                action = batch['action']
                next_state = batch['next_state']

                pred_next_state = model(state, action)
                loss = criterion(pred_next_state, next_state)
                val_losses.append(loss.item())

        # Log
        train_loss = np.mean(train_losses)
        val_loss = np.mean(val_losses)

        print(f"Epoch {epoch+1}/{epochs} - Train Loss: {train_loss:.4f}, Val Loss: {val_loss:.4f}")

        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), 'forward_model_best.pt')

        # Learning rate scheduling
        scheduler.step(val_loss)

    return model
```

---

## 2. Policy Network (Actor)

**Purpose:** Learn `π(state) → action` to minimize export

### Architecture

```python
class PolicyNetwork(nn.Module):
    """
    Actor network for SAC algorithm.

    Outputs Gaussian policy: π(a|s) = N(μ(s), σ(s))
    """

    def __init__(
        self,
        state_dim: int = 30,
        action_dim: int = 3,
        hidden_dim: int = 256,
        log_std_min: float = -20,
        log_std_max: float = 2
    ):
        super().__init__()

        self.log_std_min = log_std_min
        self.log_std_max = log_std_max

        # Shared layers
        self.shared = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU()
        )

        # Mean of Gaussian
        self.mean = nn.Linear(hidden_dim, action_dim)

        # Log standard deviation of Gaussian
        self.log_std = nn.Linear(hidden_dim, action_dim)

    def forward(self, state):
        """
        Returns mean and log_std of Gaussian policy.

        Args:
            state: [batch, state_dim]

        Returns:
            mean: [batch, action_dim]
            log_std: [batch, action_dim]
        """
        x = self.shared(state)

        mean = self.mean(x)
        log_std = self.log_std(x)

        # Clamp log_std for numerical stability
        log_std = torch.clamp(log_std, self.log_std_min, self.log_std_max)

        return mean, log_std

    def sample(self, state, deterministic=False):
        """
        Sample action from policy.

        Args:
            state: [batch, state_dim]
            deterministic: If True, return mean action

        Returns:
            action: [batch, action_dim]
            log_prob: [batch, 1] - log probability of action
        """
        mean, log_std = self.forward(state)

        if deterministic:
            # Use mean action (no exploration)
            action = mean
            log_prob = None
        else:
            # Sample from Gaussian
            std = log_std.exp()
            normal = torch.distributions.Normal(mean, std)

            # Reparameterization trick
            x_t = normal.rsample()

            # Squash to [-1, 1] using tanh
            action = torch.tanh(x_t)

            # Compute log probability (with tanh correction)
            log_prob = normal.log_prob(x_t)
            log_prob -= torch.log(1 - action.pow(2) + 1e-6)
            log_prob = log_prob.sum(dim=-1, keepdim=True)

        return action, log_prob

    def get_action(self, state, deterministic=False):
        """
        Get action for deployment (handles scaling).

        Args:
            state: [batch, state_dim] or [state_dim]

        Returns:
            action: [batch, action_dim] - scaled to [0, max_power]
        """
        if state.ndim == 1:
            state = state.unsqueeze(0)

        action, _ = self.sample(state, deterministic=deterministic)

        # Scale from [-1, 1] to [0, max_power]
        # Assume max_power = 5000W per phase
        max_power = 5000.0
        action_scaled = (action + 1) * max_power / 2  # [0, max_power]

        return action_scaled
```

---

## 3. Q-Networks (Critics)

**Purpose:** Estimate Q(s, a) = expected return for taking action a in state s

### Architecture

```python
class QNetwork(nn.Module):
    """
    Critic network for SAC algorithm.

    Estimates Q-value: Q(s, a) = E[R_t | s_t=s, a_t=a]
    """

    def __init__(
        self,
        state_dim: int = 30,
        action_dim: int = 3,
        hidden_dim: int = 256
    ):
        super().__init__()

        # Q-function approximator
        self.q = nn.Sequential(
            nn.Linear(state_dim + action_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1)  # Output scalar Q-value
        )

    def forward(self, state, action):
        """
        Args:
            state: [batch, state_dim]
            action: [batch, action_dim]

        Returns:
            q_value: [batch, 1]
        """
        x = torch.cat([state, action], dim=-1)
        q_value = self.q(x)
        return q_value


class DoubleQNetwork(nn.Module):
    """
    Twin Q-networks to mitigate overestimation bias.

    SAC uses two Q-networks and takes the minimum.
    """

    def __init__(self, state_dim, action_dim, hidden_dim=256):
        super().__init__()

        self.q1 = QNetwork(state_dim, action_dim, hidden_dim)
        self.q2 = QNetwork(state_dim, action_dim, hidden_dim)

    def forward(self, state, action):
        """
        Returns:
            q1, q2: [batch, 1]
        """
        q1 = self.q1(state, action)
        q2 = self.q2(state, action)
        return q1, q2

    def min_q(self, state, action):
        """Return minimum of two Q-values"""
        q1, q2 = self.forward(state, action)
        return torch.min(q1, q2)
```

---

## 4. Complete SAC Agent

```python
class SACAgent:
    """
    Soft Actor-Critic agent with Conservative Q-Learning.
    """

    def __init__(
        self,
        state_dim: int,
        action_dim: int,
        hidden_dim: int = 256,
        lr: float = 3e-4,
        gamma: float = 0.99,
        tau: float = 0.005,
        alpha: float = 0.2,  # Entropy temperature
        cql_alpha: float = 1.0  # CQL conservatism weight
    ):
        # Networks
        self.policy = PolicyNetwork(state_dim, action_dim, hidden_dim)
        self.q_network = DoubleQNetwork(state_dim, action_dim, hidden_dim)
        self.target_q_network = DoubleQNetwork(state_dim, action_dim, hidden_dim)

        # Copy parameters to target network
        self.target_q_network.load_state_dict(self.q_network.state_dict())

        # Optimizers
        self.policy_optimizer = torch.optim.Adam(self.policy.parameters(), lr=lr)
        self.q_optimizer = torch.optim.Adam(self.q_network.parameters(), lr=lr)

        # Hyperparameters
        self.gamma = gamma
        self.tau = tau
        self.alpha = alpha
        self.cql_alpha = cql_alpha

    def update(self, batch):
        """
        Update agent on a batch of data.

        Args:
            batch: dict with keys ['state', 'action', 'reward', 'next_state', 'done']
        """
        state = batch['state']
        action = batch['action']
        reward = batch['reward']
        next_state = batch['next_state']
        done = batch['done']

        # === Update Q-networks ===

        # Compute target Q-value
        with torch.no_grad():
            next_action, next_log_prob = self.policy.sample(next_state)

            # Target Q = min(Q1_target, Q2_target)
            target_q = self.target_q_network.min_q(next_state, next_action)

            # Add entropy bonus
            target_q = target_q - self.alpha * next_log_prob

            # Bellman target
            target_q = reward + (1 - done) * self.gamma * target_q

        # Current Q-values
        q1, q2 = self.q_network(state, action)

        # Bellman error
        q1_loss = ((q1 - target_q) ** 2).mean()
        q2_loss = ((q2 - target_q) ** 2).mean()

        # CQL conservatism penalty
        # Penalize Q-values for random actions (make conservative)
        random_actions = torch.rand_like(action) * 2 - 1  # Uniform[-1, 1]
        q1_random, q2_random = self.q_network(state, random_actions)

        cql_penalty = (q1_random.logsumexp(0) - q1.mean() +
                       q2_random.logsumexp(0) - q2.mean())

        q_loss = q1_loss + q2_loss + self.cql_alpha * cql_penalty

        # Update Q-networks
        self.q_optimizer.zero_grad()
        q_loss.backward()
        self.q_optimizer.step()

        # === Update Policy ===

        # Sample actions from current policy
        new_action, log_prob = self.policy.sample(state)

        # Q-value for new actions
        q_new = self.q_network.min_q(state, new_action)

        # Policy loss (maximize Q, maximize entropy)
        policy_loss = (self.alpha * log_prob - q_new).mean()

        # Update policy
        self.policy_optimizer.zero_grad()
        policy_loss.backward()
        self.policy_optimizer.step()

        # === Update Target Q-networks (soft update) ===
        for target_param, param in zip(self.target_q_network.parameters(),
                                        self.q_network.parameters()):
            target_param.data.copy_(
                self.tau * param.data + (1 - self.tau) * target_param.data
            )

        return {
            'q_loss': q_loss.item(),
            'policy_loss': policy_loss.item(),
            'q1': q1.mean().item(),
            'q2': q2.mean().item()
        }

    def get_action(self, state, deterministic=False):
        """Get action for deployment"""
        with torch.no_grad():
            action = self.policy.get_action(state, deterministic=deterministic)
        return action.cpu().numpy()

    def save(self, path):
        """Save model weights"""
        torch.save({
            'policy': self.policy.state_dict(),
            'q_network': self.q_network.state_dict(),
            'target_q_network': self.target_q_network.state_dict()
        }, path)

    def load(self, path):
        """Load model weights"""
        checkpoint = torch.load(path)
        self.policy.load_state_dict(checkpoint['policy'])
        self.q_network.load_state_dict(checkpoint['q_network'])
        self.target_q_network.load_state_dict(checkpoint['target_q_network'])
```

---

## 5. Training Loop

```python
def train_sac_agent(agent, forward_model, train_loader, val_loader, epochs=1000):
    """
    Train SAC agent with forward model.
    """

    for epoch in range(epochs):
        # Training
        agent.policy.train()
        agent.q_network.train()

        train_metrics = []

        for batch in train_loader:
            # Move batch to device
            batch = {k: v.to(device) for k, v in batch.items()}

            # Update agent
            metrics = agent.update(batch)
            train_metrics.append(metrics)

        # Validation (evaluate policy performance)
        agent.policy.eval()
        val_rewards = []

        with torch.no_grad():
            for batch in val_loader:
                state = batch['state'].to(device)
                action = agent.policy.get_action(state, deterministic=True)

                # Use forward model to predict outcome
                next_state = forward_model(state, action)

                # Compute reward
                reward = compute_reward_batch(state, action, next_state)
                val_rewards.append(reward.mean().item())

        # Log metrics
        avg_q_loss = np.mean([m['q_loss'] for m in train_metrics])
        avg_policy_loss = np.mean([m['policy_loss'] for m in train_metrics])
        avg_val_reward = np.mean(val_rewards)

        print(f"Epoch {epoch+1}/{epochs}")
        print(f"  Q Loss: {avg_q_loss:.4f}")
        print(f"  Policy Loss: {avg_policy_loss:.4f}")
        print(f"  Val Reward: {avg_val_reward:.4f}")

        # Save checkpoint
        if (epoch + 1) % 10 == 0:
            agent.save(f'sac_agent_epoch_{epoch+1}.pt')

    return agent
```

---

## Model Summary

### Forward Dynamics Model
- **Input:** State (30D) + Action (3D)
- **Output:** Next State (30D)
- **Parameters:** ~500K
- **Training:** Supervised learning on historical data

### Policy Network
- **Input:** State (30D)
- **Output:** Action distribution (Gaussian, 3D)
- **Parameters:** ~200K
- **Training:** SAC with CQL

### Q-Networks (x2)
- **Input:** State (30D) + Action (3D)
- **Output:** Q-value (1D)
- **Parameters:** ~200K each
- **Training:** TD learning with CQL penalty

**Total Parameters:** ~1.1M (lightweight, fast inference)

---

## Deployment

```python
class DeployedRLController:
    """
    Production-ready RL controller with safety checks.
    """

    def __init__(self, model_path: str, max_power: float = 5000):
        # Load trained agent
        self.agent = SACAgent(state_dim=30, action_dim=3)
        self.agent.load(model_path)
        self.agent.policy.eval()

        self.max_power = max_power

    def get_action(self, state: np.ndarray) -> np.ndarray:
        """
        Get action from RL policy.

        Args:
            state: [state_dim] numpy array

        Returns:
            action: [action_dim] - power targets per phase (W)
        """
        # Convert to tensor
        state_tensor = torch.FloatTensor(state).unsqueeze(0)

        # Get action (deterministic for deployment)
        with torch.no_grad():
            action = self.agent.get_action(state_tensor, deterministic=True)

        # Safety checks
        action = np.clip(action, 0, self.max_power)

        return action.squeeze()

    def compute_zigbee_command(self, action: np.ndarray, num_slaves_per_phase: list) -> list:
        """
        Convert RL action to Zigbee command format.

        Args:
            action: [3] - total power per phase
            num_slaves_per_phase: [na, nb, nc] - number of slaves per phase

        Returns:
            command: [[phase_a], [phase_b], [phase_c]]
        """
        command = []

        for phase_idx in range(3):
            total_power = action[phase_idx]
            num_slaves = num_slaves_per_phase[phase_idx]

            if num_slaves > 0:
                # Distribute evenly across slaves
                power_per_slave = total_power / num_slaves
                phase_command = [int(power_per_slave)] * num_slaves
            else:
                phase_command = []

            command.append(phase_command)

        return command
```

---

## Next Steps

1. Implement architectures in PyTorch
2. Train forward model on historical data
3. Pre-train policy with behavior cloning
4. Fine-tune with SAC + CQL
5. Validate on test set
6. Deploy in shadow mode

## Hyperparameter Tuning

Key hyperparameters to tune:
- Learning rates (lr)
- Hidden dimensions (hidden_dim)
- CQL conservatism (cql_alpha)
- Entropy temperature (alpha)
- Discount factor (gamma)
- Lookahead steps (forward model)
