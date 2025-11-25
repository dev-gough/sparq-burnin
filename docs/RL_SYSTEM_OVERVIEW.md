# RL-Based Energy Export Minimization System

## Executive Summary

This document outlines a reinforcement learning (RL) system to replace the existing PI control loop for minimizing energy export in a 3-phase grid-tied system with multiple Zigbee-controlled slave devices.

**Current System:** PI control loop with reference power values
**Proposed System:** Model-based RL with forward dynamics modeling
**Key Challenge:** Multi-second input delay from Zigbee commands to measurable effect
**Data Volume:** ~40GB historical data, few months of meter readings

---

## Problem Formulation

### System Architecture

```
Master Controller (RL Agent)
    ↓ Zigbee Broadcast Commands [[phase_a], [phase_b], [phase_c]]
    ↓ (Multi-second delay)
Slave Devices (per-phase power consumption)
    ↓ AC Power Out (per slave)
    ↓ Cumulative Effect
3-Phase Energy Meter
    ↓ Export/Import Readings
RL Agent (observes result)
```

### Objective

**Primary Goal:** Minimize total energy export to grid over time
**Secondary Goal:** Optional phase balancing (configurable)
**Constraint:** Never set negative power targets when setpoint is positive (would increase export)

---

## Reinforcement Learning Framework

### State Space (Observation)

```python
state = {
    # Meter Readings (current snapshot)
    'grid_power_total': float,           # Total export/import (W)
    'grid_power_per_phase': [a, b, c],   # Per-phase power (W)
    'grid_voltage_per_phase': [a, b, c], # Phase voltages (V)
    'grid_current_per_phase': [a, b, c], # Phase currents (A)
    'pv_generation': float,              # Total PV power (W)
    'cumulative_import_kwh': [a, b, c],  # Per-phase cumulative import
    'cumulative_export_kwh': [a, b, c],  # Per-phase cumulative export

    # Slave Device Feedback (NEW - coming soon)
    'slave_ac_power_out': [
        [slave1_a, slave2_a, ...],  # Phase A slaves
        [slave1_b, slave2_b, ...],  # Phase B slaves
        [slave1_c, slave2_c, ...]   # Phase C slaves
    ],

    # Command History (handle delay)
    'last_command_sent': [[],[],[]],     # Most recent broadcast
    'command_timestamps': [t_a, t_b, t_c], # Seconds since each phase command
    'command_history_5s': [...],         # Rolling window of recent commands

    # PI Controller Context (current baseline)
    'pi_reference_power': float,         # Reference value PI uses
    'pi_error': float,                   # Current PI error term
    'pi_output': float,                  # Current PI output (for comparison)

    # Temporal Features
    'time_of_day': float,               # 0-24 hours
    'day_of_week': int,                 # 0-6
    'is_peak_hours': bool,              # Utility rate context

    # System Metadata
    'total_slaves_active': int,
    'slaves_per_phase': [count_a, count_b, count_c]
}
```

**State Dimensionality:** ~30-50 features (fixed size after encoding)

### Action Space (Control Commands)

**Option 1: Simplified Aggregate Control** (Recommended for v1)
```python
action = {
    'phase_a_total_target': float,  # Total power for phase A (W)
    'phase_b_total_target': float,  # Total power for phase B (W)
    'phase_c_total_target': float   # Total power for phase C (W)
}

# Constraints:
# - Each target >= 0 (no negative power)
# - Sum <= total_available_capacity
# - Action space: Continuous [0, max_power]^3
```

**Option 2: Delta-based Control** (More stable)
```python
action = {
    'delta_phase_a': float,  # Change to phase A (-500 to +500W)
    'delta_phase_b': float,  # Change to phase B
    'delta_phase_c': float   # Change to phase C
}

# Apply as: new_target = clip(current_target + delta, 0, max_power)
```

**Option 3: Per-Slave Control** (Future, higher complexity)
```python
action = {
    'phase_a_slaves': [power1, power2, ...],
    'phase_b_slaves': [power1, power2, ...],
    'phase_c_slaves': [power1, power2, ...]
}
```

**Recommended:** Start with Option 2 (Delta-based) for training stability

### Reward Function

```python
def compute_reward(state, action, next_state):
    # Primary objective: minimize export
    export_penalty = -max(0, next_state['grid_power_total'])

    # Penalize oscillation (rapid command changes)
    command_change = norm(action['delta'] - prev_action['delta'])
    oscillation_penalty = -0.1 * command_change

    # Penalize phase imbalance (if enabled)
    if phase_balancing_enabled:
        phase_std = std(next_state['grid_power_per_phase'])
        imbalance_penalty = -0.05 * phase_std
    else:
        imbalance_penalty = 0

    # Penalize negative setpoints (safety constraint)
    negative_penalty = -1000 * sum(action < 0)

    # Total reward
    reward = (
        export_penalty +
        oscillation_penalty +
        imbalance_penalty +
        negative_penalty
    )

    return reward
```

**Key Considerations:**
- Reward weights need tuning based on real data
- Export penalty dominates (primary goal)
- Oscillation penalty prevents chattering
- Negative penalty enforces hard constraint

---

## Model-Based RL Architecture

### Why Model-Based?

**Challenge:** Multi-second delay between action → observable effect

**Solution:** Learn a forward dynamics model to predict future states

```
Forward Model: f(state_t, action_t) → state_{t+5s}
```

This allows:
1. **Lookahead planning:** Predict effects before they happen
2. **Credit assignment:** Attribute rewards to correct actions despite delay
3. **Sample efficiency:** Learn from fewer real-world interactions

### Architecture Components

#### 1. Forward Dynamics Model

**Input:** `[state_t, action_t, slave_feedback_t]`
**Output:** `state_{t+k}` (k = 3-10 seconds ahead)

```python
class ForwardDynamicsModel(nn.Module):
    def __init__(self):
        self.encoder = nn.Sequential(
            nn.Linear(state_dim + action_dim + slave_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 128)
        )

        # LSTM to model temporal dynamics
        self.lstm = nn.LSTM(128, 128, num_layers=2)

        # Predict delta (more stable than absolute)
        self.predictor = nn.Sequential(
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Linear(128, state_dim)
        )

    def forward(self, state, action, slave_feedback):
        x = torch.cat([state, action, slave_feedback], dim=-1)
        encoded = self.encoder(x)
        lstm_out, _ = self.lstm(encoded)
        delta_state = self.predictor(lstm_out)
        return state + delta_state  # Residual connection
```

**Training:**
- Supervised learning on historical data
- Loss: MSE between predicted and actual next state
- Focus on predicting `grid_power_total` accurately

#### 2. Policy Network (RL Agent)

**Algorithm:** Soft Actor-Critic (SAC)
- Handles continuous action spaces
- Sample efficient
- Stable training

```python
class PolicyNetwork(nn.Module):
    def __init__(self):
        self.shared = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 128),
            nn.ReLU()
        )

        # Output mean and log_std for Gaussian policy
        self.mean = nn.Linear(128, action_dim)
        self.log_std = nn.Linear(128, action_dim)

    def forward(self, state):
        x = self.shared(state)
        mean = self.mean(x)
        log_std = torch.clamp(self.log_std(x), -20, 2)
        return mean, log_std

    def sample(self, state):
        mean, log_std = self.forward(state)
        std = log_std.exp()
        normal = Normal(mean, std)
        action = normal.rsample()  # Reparameterization trick
        return torch.tanh(action)  # Squash to [-1, 1], then scale
```

#### 3. Training Pipeline

**Phase 1: Learn Forward Model** (Supervised)
```
Historical Data → (state, action, next_state) tuples
                → Train forward model
                → Validate prediction accuracy
```

**Phase 2: Offline RL** (Conservative Q-Learning)
```
Use forward model + historical data
→ Train policy without real-world interaction
→ Conservative updates (stay close to data distribution)
```

**Phase 3: Online Fine-tuning** (Optional)
```
Deploy policy in shadow mode (log only)
→ Collect on-policy data
→ Fine-tune with real feedback
→ Gradual rollout
```

---

## Data Pipeline

### Data Sources

```
Historical Logs (40GB):
├── 3-Phase Meter Readings (timestamped)
│   ├── grid_power, voltage, current per phase
│   ├── cumulative import/export kWh
│   └── PV generation data
├── Zigbee Broadcast Commands (timestamped)
│   ├── Command payload [[],[],[]]
│   ├── Target device IDs
│   └── Command acknowledgment
├── PI Controller State (timestamped)
│   ├── Reference power values
│   ├── Error terms
│   └── Output commands
└── Slave AC Power Output (COMING SOON)
    ├── Per-slave power consumption
    └── Response latency metrics
```

### Preprocessing Steps

#### 1. Timestamp Alignment
```python
# Challenge: Different data sources may have different sampling rates
# Solution: Resample to common timestep (e.g., 1 second intervals)

def align_timeseries(meter_data, zigbee_logs, pi_state):
    # Resample to 1Hz
    meter_resampled = meter_data.resample('1S').mean()
    zigbee_resampled = zigbee_logs.resample('1S').ffill()  # Forward-fill commands
    pi_resampled = pi_state.resample('1S').ffill()

    # Merge on timestamp
    aligned = pd.merge_asof(
        meter_resampled,
        zigbee_resampled,
        on='timestamp',
        direction='backward'
    )
    return aligned
```

#### 2. Feature Engineering
```python
def engineer_features(df):
    # Rolling statistics (capture trends)
    df['export_power_ma_5s'] = df['grid_power_total'].rolling(5).mean()
    df['export_power_std_5s'] = df['grid_power_total'].rolling(5).std()

    # Rate of change
    df['dP_dt'] = df['grid_power_total'].diff() / df['timestamp'].diff().dt.seconds

    # Command age (time since last command)
    df['time_since_command'] = (df['timestamp'] - df['last_command_time']).dt.seconds

    # Temporal features
    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek

    return df
```

#### 3. Create RL Dataset
```python
def create_rl_dataset(df, lookahead=5):
    """
    Create (state, action, reward, next_state) tuples

    Args:
        df: Aligned timeseries dataframe
        lookahead: Seconds to look ahead for next_state (handle delay)
    """
    dataset = []

    for i in range(len(df) - lookahead):
        state = extract_state(df.iloc[i])
        action = extract_action(df.iloc[i])  # Command that was sent
        next_state = extract_state(df.iloc[i + lookahead])
        reward = compute_reward(state, action, next_state)

        dataset.append({
            'state': state,
            'action': action,
            'reward': reward,
            'next_state': next_state,
            'done': False  # Continuous task
        })

    return dataset
```

#### 4. Data Quality Checks
```python
def validate_data_quality(dataset):
    # Check for missing values
    assert dataset.isnull().sum().sum() == 0, "Missing values found"

    # Check for unrealistic values
    assert (dataset['grid_power_total'] >= -50000).all(), "Invalid power readings"

    # Check for sufficient variance
    assert dataset['grid_power_total'].std() > 100, "Insufficient variance"

    # Check action validity
    assert (dataset['action'] >= 0).all().all(), "Negative actions found"

    print("Data quality checks passed ✓")
```

---

## Handling Multi-Second Delay

### Problem
```
t=0s:  Send command A
t=1s:  No visible effect yet
t=2s:  No visible effect yet
t=3s:  Effect starts appearing
t=5s:  Full effect visible
```

If we naively assign reward at t=1s, the RL agent learns wrong associations.

### Solutions

#### Solution 1: Lookahead States (Implemented in dataset creation)
```python
# When creating dataset, use next_state from 5 seconds in future
state_t0 = data[t=0]
action_t0 = data[t=0]
next_state = data[t=5]  # Wait for effect
reward = compute_reward(state_t0, action_t0, next_state)
```

#### Solution 2: State Includes Command History
```python
state = {
    ...,
    'commands_sent_last_10s': [...],  # Agent knows what's "in flight"
    'command_ages': [2s, 5s, 8s]      # How long ago each was sent
}
```

The agent learns: "If I sent command X 3 seconds ago, I should wait before sending Y"

#### Solution 3: Forward Model (Prediction)
```python
# Train model: f(state, action) → state_after_5s
predicted_next_state = forward_model(current_state, candidate_action)
predicted_reward = compute_reward(current_state, candidate_action, predicted_next_state)

# Use predicted reward for planning
```

**Recommended:** Use all three in combination

---

## Training Strategy

### Offline RL (Initial Training)

**Algorithm:** Conservative Q-Learning (CQL)

**Why CQL?**
- Designed for offline RL
- Penalizes out-of-distribution actions
- Safe for deployment (won't try crazy things)

```python
# CQL Loss
def cql_loss(Q, dataset):
    # Standard Q-learning loss
    bellman_error = (Q(s, a) - (r + γ * Q(s', a')))**2

    # Conservative penalty: penalize Q-values for unseen actions
    sampled_actions = sample_random_actions()
    conservatism_penalty = Q(s, sampled_actions).logsumexp()

    loss = bellman_error + α * conservatism_penalty
    return loss
```

### Training Loop

```python
# 1. Train forward dynamics model
forward_model.train(historical_data)

# 2. Pre-train policy with behavior cloning (imitate PI controller)
policy.pretrain(historical_data, epochs=50)

# 3. Fine-tune with CQL
for epoch in range(1000):
    batch = sample_batch(historical_data)

    # Update critic
    critic_loss = cql_loss(critic, batch)
    critic_loss.backward()

    # Update actor (policy)
    actor_loss = -critic(state, policy(state)).mean()
    actor_loss.backward()

    # Log metrics
    if epoch % 10 == 0:
        validate(policy, validation_set)
```

### Evaluation Metrics

**Offline Validation:**
- Mean export power (kWh/day) on test set
- Peak export reduction (%)
- Command oscillation rate (commands/minute)
- Phase balance variance (if enabled)

**Comparison Baseline:**
- PI controller performance on same test set

**Success Criteria:**
- RL policy reduces export by ≥10% vs PI
- No safety violations (negative commands when setpoint > 0)
- Stable operation (no excessive oscillation)

---

## Deployment Strategy

### Phase 1: Shadow Mode (Weeks 1-2)
```
PI Controller (live) ──> Actual commands sent
RL Policy (shadow)   ──> Logged only, not executed

Compare:
- What would RL have done?
- Would it have improved performance?
- Any safety violations?
```

### Phase 2: A/B Testing (Weeks 3-4)
```
Time slot A (8am-12pm):  PI controller
Time slot B (12pm-4pm):  RL policy
Time slot C (4pm-8pm):   PI controller

Measure:
- Export reduction during RL time slots
- System stability metrics
```

### Phase 3: Gradual Rollout (Weeks 5-8)
```
RL Policy % of time: 25% → 50% → 75% → 100%
Monitor continuously
Automatic fallback to PI if anomalies detected
```

### Safety Mechanisms

```python
class SafeRLController:
    def __init__(self, rl_policy, pi_controller):
        self.rl = rl_policy
        self.pi = pi_controller
        self.anomaly_detector = AnomalyDetector()

    def get_action(self, state):
        # Get RL action
        rl_action = self.rl(state)

        # Safety checks
        if not self.is_safe(rl_action, state):
            print("SAFETY VIOLATION: Falling back to PI")
            return self.pi(state)

        # Anomaly detection
        if self.anomaly_detector.is_anomalous(state, rl_action):
            print("ANOMALY DETECTED: Falling back to PI")
            return self.pi(state)

        return rl_action

    def is_safe(self, action, state):
        # Check: no negative commands when setpoint > 0
        if state['setpoint'] > 0 and (action < 0).any():
            return False

        # Check: action within bounds
        if (action < 0).any() or (action > MAX_POWER).any():
            return False

        # Check: not changing too fast
        if norm(action - self.last_action) > MAX_DELTA:
            return False

        return True
```

---

## Next Steps

### Immediate (Planning Phase)
1. ✅ Define RL problem formulation
2. ⏳ Design data preprocessing pipeline
3. ⏳ Specify model architectures
4. ⏳ Plan training infrastructure
5. ⏳ Define evaluation metrics

### Short-term (Implementation Phase 1)
1. Extract and align historical data
2. Implement preprocessing pipeline
3. Train forward dynamics model
4. Validate forward model accuracy

### Medium-term (Implementation Phase 2)
1. Implement CQL algorithm
2. Pre-train policy with behavior cloning
3. Fine-tune with offline RL
4. Offline evaluation vs PI baseline

### Long-term (Deployment)
1. Shadow mode deployment
2. A/B testing
3. Gradual rollout
4. Continuous monitoring and retraining

---

## Open Questions

1. **Slave AC Power Feedback Availability:**
   - When will per-slave AC power measurements be available?
   - What's the sampling rate and latency?

2. **Phase Balancing Priority:**
   - Under what conditions should phase balancing be enabled?
   - What's the acceptable phase imbalance threshold?

3. **PI Controller Details:**
   - What are current PI controller parameters (Kp, Ki)?
   - What's the typical performance (export kWh/day)?
   - Can we access PI internal state for comparison?

4. **Deployment Constraints:**
   - What's the target inference latency (e.g., <100ms)?
   - What hardware will run the RL model?
   - Are there fallback requirements if RL fails?

5. **Data Access:**
   - Can we export historical data in a structured format (CSV/Parquet)?
   - What's the schema for Zigbee command logs?
   - Are there any data privacy/security concerns?
