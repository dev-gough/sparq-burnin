# RL Training Infrastructure & Deployment Strategy

## Overview

This document outlines the training infrastructure, evaluation methodology, and deployment strategy for the RL-based energy export minimization system.

---

## Training Infrastructure

### Hardware Requirements

#### For Training
```
GPU: NVIDIA RTX 3060 or better (12GB+ VRAM recommended)
- Forward model training: ~4-8 hours
- RL training: ~12-24 hours
- Total training time: ~1-2 days

CPU: 8+ cores for data preprocessing
RAM: 32GB+ (for handling 40GB dataset)
Storage: 100GB+ SSD (for data + models + checkpoints)
```

#### For Deployment
```
Edge Device (Master Controller):
- CPU: Any modern ARM/x86 (Raspberry Pi 4+ works)
- RAM: 2GB+
- Inference time: <10ms per action
- No GPU required for deployment
```

### Software Stack

```yaml
Environment:
  python: "3.10+"
  pytorch: "2.0+"
  cuda: "11.8+" (for training only)

Core Dependencies:
  - torch
  - numpy
  - pandas
  - scikit-learn
  - matplotlib
  - tensorboard

Data Processing:
  - polars (faster than pandas for large datasets)
  - pyarrow (for Parquet files)

Optional:
  - wandb (experiment tracking)
  - ray[tune] (hyperparameter tuning)
```

### Project Structure

```
rl-energy-control/
├── data/
│   ├── raw/                    # Raw logs (40GB)
│   │   ├── meter_readings/
│   │   ├── zigbee_commands/
│   │   └── pi_state/
│   ├── processed/              # Aligned & engineered features
│   │   ├── train_dataset.pkl
│   │   ├── val_dataset.pkl
│   │   └── test_dataset.pkl
│   └── statistics/             # Data statistics for normalization
│       └── normalization_params.json
│
├── models/
│   ├── forward_model.py        # Forward dynamics model
│   ├── policy.py               # SAC policy network
│   ├── critic.py               # SAC Q-networks
│   └── agent.py                # Complete SAC agent
│
├── training/
│   ├── train_forward_model.py  # Train forward model
│   ├── train_sac.py            # Train RL agent
│   ├── pretrain_bc.py          # Behavior cloning pre-training
│   └── utils.py                # Training utilities
│
├── preprocessing/
│   ├── load_data.py            # Data loaders
│   ├── align_timestamps.py     # Timestamp alignment
│   ├── feature_engineering.py  # Feature engineering
│   └── build_dataset.py        # Create RL dataset
│
├── evaluation/
│   ├── evaluate_forward_model.py
│   ├── evaluate_policy.py
│   ├── compare_baselines.py    # Compare RL vs PI
│   └── metrics.py              # Evaluation metrics
│
├── deployment/
│   ├── controller.py           # Production RL controller
│   ├── safety_wrapper.py       # Safety checks
│   ├── fallback_pi.py          # Fallback PI controller
│   └── monitor.py              # Monitoring & logging
│
├── configs/
│   ├── data_config.yaml        # Data pipeline config
│   ├── model_config.yaml       # Model hyperparameters
│   └── training_config.yaml    # Training settings
│
├── experiments/
│   └── wandb/                  # Experiment logs
│
├── checkpoints/                # Saved model weights
│
└── scripts/
    ├── run_full_pipeline.sh    # End-to-end pipeline
    ├── download_data.sh        # Data download
    └── deploy.sh               # Deployment script
```

---

## Training Pipeline

### Phase 1: Data Preprocessing (1-2 days)

```bash
# Step 1: Load and validate raw data
python preprocessing/load_data.py \
    --raw_dir data/raw \
    --output_dir data/interim

# Step 2: Align timestamps
python preprocessing/align_timestamps.py \
    --input_dir data/interim \
    --output_dir data/interim \
    --resample_freq 1S

# Step 3: Feature engineering
python preprocessing/feature_engineering.py \
    --input_dir data/interim \
    --output_dir data/processed

# Step 4: Build RL dataset
python preprocessing/build_dataset.py \
    --input_dir data/processed \
    --output_dir data/processed \
    --lookahead_seconds 5 \
    --train_ratio 0.7 \
    --val_ratio 0.15 \
    --test_ratio 0.15
```

**Output:**
- `train_dataset.pkl` (70% of data)
- `val_dataset.pkl` (15% of data)
- `test_dataset.pkl` (15% of data)
- `normalization_params.json` (feature normalization stats)

### Phase 2: Train Forward Dynamics Model (4-8 hours)

```bash
python training/train_forward_model.py \
    --train_data data/processed/train_dataset.pkl \
    --val_data data/processed/val_dataset.pkl \
    --state_dim 30 \
    --action_dim 3 \
    --hidden_dim 256 \
    --lstm_hidden 128 \
    --lookahead_steps 5 \
    --batch_size 256 \
    --epochs 100 \
    --lr 1e-3 \
    --output_dir checkpoints/forward_model
```

**Evaluation:**
```bash
python evaluation/evaluate_forward_model.py \
    --model checkpoints/forward_model/best.pt \
    --test_data data/processed/test_dataset.pkl
```

**Success Criteria:**
- Test MSE < 0.1 (normalized state space)
- Export power prediction MAE < 100W
- Trajectory prediction stable for 10+ steps

### Phase 3: Pre-train Policy (Behavior Cloning) (2-4 hours)

**Why?** Jump-start RL by imitating the existing PI controller

```bash
python training/pretrain_bc.py \
    --train_data data/processed/train_dataset.pkl \
    --val_data data/processed/val_dataset.pkl \
    --state_dim 30 \
    --action_dim 3 \
    --hidden_dim 256 \
    --batch_size 256 \
    --epochs 50 \
    --lr 1e-3 \
    --output_dir checkpoints/policy_pretrained
```

**Evaluation:**
```bash
# Test pre-trained policy (should match PI performance)
python evaluation/evaluate_policy.py \
    --policy checkpoints/policy_pretrained/best.pt \
    --test_data data/processed/test_dataset.pkl \
    --forward_model checkpoints/forward_model/best.pt
```

### Phase 4: Train RL Agent (SAC + CQL) (12-24 hours)

```bash
python training/train_sac.py \
    --train_data data/processed/train_dataset.pkl \
    --val_data data/processed/val_dataset.pkl \
    --pretrained_policy checkpoints/policy_pretrained/best.pt \
    --forward_model checkpoints/forward_model/best.pt \
    --state_dim 30 \
    --action_dim 3 \
    --hidden_dim 256 \
    --batch_size 256 \
    --epochs 1000 \
    --lr 3e-4 \
    --gamma 0.99 \
    --tau 0.005 \
    --alpha 0.2 \
    --cql_alpha 1.0 \
    --output_dir checkpoints/sac_agent
```

**Hyperparameter Tuning (optional):**
```bash
# Use Ray Tune for automated hyperparameter search
python training/tune_hyperparams.py \
    --num_samples 50 \
    --gpus_per_trial 1
```

**Evaluation:**
```bash
# Offline evaluation on test set
python evaluation/evaluate_policy.py \
    --policy checkpoints/sac_agent/best.pt \
    --test_data data/processed/test_dataset.pkl \
    --forward_model checkpoints/forward_model/best.pt

# Compare with baselines
python evaluation/compare_baselines.py \
    --rl_policy checkpoints/sac_agent/best.pt \
    --pi_baseline data/processed/test_dataset.pkl \
    --forward_model checkpoints/forward_model/best.pt
```

---

## Evaluation Metrics

### Offline Evaluation (on historical data)

```python
class EvaluationMetrics:
    """Metrics for evaluating RL policy"""

    def __init__(self):
        self.metrics = {}

    def compute_export_reduction(self, rl_export, baseline_export):
        """
        Primary metric: % reduction in energy export

        Args:
            rl_export: [T] - export power with RL policy (W)
            baseline_export: [T] - export power with PI baseline (W)

        Returns:
            reduction_percent: float
        """
        rl_total = np.sum(np.maximum(0, rl_export))  # Total export (kWh)
        baseline_total = np.sum(np.maximum(0, baseline_export))

        reduction = (baseline_total - rl_total) / baseline_total * 100
        return reduction

    def compute_peak_export_reduction(self, rl_export, baseline_export):
        """Reduction in peak export power"""
        rl_peak = np.max(rl_export)
        baseline_peak = np.max(baseline_export)

        reduction = (baseline_peak - rl_peak) / baseline_peak * 100
        return reduction

    def compute_oscillation_rate(self, actions):
        """
        Measure control stability (commands per minute)

        Args:
            actions: [T, 3] - action sequence

        Returns:
            oscillations_per_minute: float
        """
        # Count action changes
        action_changes = np.sum(np.any(np.diff(actions, axis=0) != 0, axis=1))

        # Assume 1Hz sampling, convert to per minute
        oscillations_per_minute = action_changes / (len(actions) / 60)

        return oscillations_per_minute

    def compute_phase_imbalance(self, phase_powers):
        """
        Measure phase balance quality

        Args:
            phase_powers: [T, 3] - power per phase over time

        Returns:
            avg_std: float - average std dev across time
        """
        phase_std = np.std(phase_powers, axis=1)
        return np.mean(phase_std)

    def compute_all(self, rl_data, baseline_data):
        """Compute all metrics"""
        return {
            'export_reduction_%': self.compute_export_reduction(
                rl_data['export'], baseline_data['export']
            ),
            'peak_export_reduction_%': self.compute_peak_export_reduction(
                rl_data['export'], baseline_data['export']
            ),
            'oscillation_rate_per_min': self.compute_oscillation_rate(
                rl_data['actions']
            ),
            'phase_imbalance_W': self.compute_phase_imbalance(
                rl_data['phase_powers']
            )
        }
```

### Success Criteria

**Offline Validation (Required before deployment):**
- ✅ Export reduction ≥ 10% vs PI baseline
- ✅ Peak export reduction ≥ 5%
- ✅ Oscillation rate < 10 changes/minute
- ✅ Phase imbalance < 500W std dev
- ✅ No safety violations (negative commands)

**Online Validation (Shadow mode):**
- ✅ RL predictions stable for 24+ hours
- ✅ No anomalies detected
- ✅ Latency < 100ms per action

---

## Deployment Strategy

### Phase 1: Shadow Mode (Weeks 1-2)

**Goal:** Validate RL performance in real-time without affecting system

```python
# deployment/shadow_mode.py

class ShadowModeController:
    def __init__(self, rl_policy, pi_controller):
        self.rl = rl_policy
        self.pi = pi_controller
        self.logger = Logger()

    def run(self, state):
        # PI controller runs live (actual commands)
        pi_action = self.pi.get_action(state)

        # RL policy runs in shadow (logged only)
        rl_action = self.rl.get_action(state)

        # Log both for comparison
        self.logger.log({
            'timestamp': time.time(),
            'state': state,
            'pi_action': pi_action,
            'rl_action': rl_action,
            'action_diff': np.linalg.norm(rl_action - pi_action)
        })

        # Send PI action (RL is shadow only)
        return pi_action
```

**Metrics to Monitor:**
- How often would RL have made different decisions?
- Would RL have reduced export?
- Any safety violations?
- Action stability

### Phase 2: A/B Testing (Weeks 3-4)

**Goal:** Compare RL vs PI in live conditions

```python
# deployment/ab_testing.py

class ABTestController:
    def __init__(self, rl_policy, pi_controller, ab_schedule):
        self.rl = rl_policy
        self.pi = pi_controller
        self.schedule = ab_schedule  # e.g., {"rl": [(8, 12), (16, 20)]}

    def get_controller(self):
        """Determine which controller to use based on time"""
        current_hour = datetime.now().hour

        for start, end in self.schedule['rl']:
            if start <= current_hour < end:
                return 'rl', self.rl

        return 'pi', self.pi

    def run(self, state):
        name, controller = self.get_controller()
        action = controller.get_action(state)

        self.logger.log({
            'timestamp': time.time(),
            'controller': name,
            'state': state,
            'action': action
        })

        return action
```

**Schedule Example:**
```
Monday-Friday:
  8am-12pm: PI controller
  12pm-4pm: RL controller
  4pm-8pm: PI controller

Weekend:
  All day: PI controller (conservative)
```

**Metrics to Compare:**
- Export reduction during RL time slots
- Peak export during RL time slots
- Grid stability metrics
- Any issues/anomalies

### Phase 3: Gradual Rollout (Weeks 5-8)

**Goal:** Increase RL usage from 25% → 100%

```python
# deployment/gradual_rollout.py

class GradualRolloutController:
    def __init__(self, rl_policy, pi_controller):
        self.rl = rl_policy
        self.pi = pi_controller
        self.rl_percentage = 0  # Start at 0%

    def set_rollout_percentage(self, percentage):
        """Set RL usage percentage (0-100)"""
        self.rl_percentage = np.clip(percentage, 0, 100)
        print(f"RL rollout: {self.rl_percentage}%")

    def run(self, state):
        # Random sampling based on rollout percentage
        use_rl = np.random.rand() < (self.rl_percentage / 100)

        if use_rl:
            controller_name = 'rl'
            action = self.rl.get_action(state)
        else:
            controller_name = 'pi'
            action = self.pi.get_action(state)

        self.logger.log({
            'timestamp': time.time(),
            'controller': controller_name,
            'state': state,
            'action': action
        })

        return action
```

**Rollout Schedule:**
- Week 5: 25% RL
- Week 6: 50% RL
- Week 7: 75% RL
- Week 8: 100% RL (if no issues)

**Rollback Triggers:**
- Export increases > 5% vs baseline
- Safety violations detected
- System instability (oscillations)
- Anomaly detection threshold exceeded

### Phase 4: Full Deployment (Week 9+)

**Goal:** RL as primary controller with PI fallback

```python
# deployment/production_controller.py

class ProductionController:
    def __init__(self, rl_policy, pi_controller, safety_checker, anomaly_detector):
        self.rl = rl_policy
        self.pi = pi_controller
        self.safety = safety_checker
        self.anomaly = anomaly_detector

        self.fallback_active = False
        self.fallback_until = None

    def run(self, state):
        # Check if in fallback mode
        if self.fallback_active:
            if datetime.now() < self.fallback_until:
                return self.pi.get_action(state)
            else:
                # Try re-enabling RL
                self.fallback_active = False
                print("Re-enabling RL controller")

        # Get RL action
        rl_action = self.rl.get_action(state)

        # Safety checks
        if not self.safety.is_safe(rl_action, state):
            print("SAFETY VIOLATION: Falling back to PI")
            self.activate_fallback(duration_hours=1)
            return self.pi.get_action(state)

        # Anomaly detection
        if self.anomaly.is_anomalous(state, rl_action):
            print("ANOMALY DETECTED: Falling back to PI")
            self.activate_fallback(duration_hours=24)
            return self.pi.get_action(state)

        # All checks passed - use RL
        return rl_action

    def activate_fallback(self, duration_hours):
        """Temporarily switch to PI controller"""
        self.fallback_active = True
        self.fallback_until = datetime.now() + timedelta(hours=duration_hours)
        self.logger.alert(f"Fallback activated for {duration_hours} hours")
```

---

## Safety & Monitoring

### Safety Checks

```python
class SafetyChecker:
    def __init__(self, max_power=5000, max_delta=1000):
        self.max_power = max_power
        self.max_delta = max_delta
        self.last_action = None

    def is_safe(self, action, state):
        """
        Verify action is safe to execute.

        Checks:
        1. No negative power (when setpoint > 0)
        2. Within power bounds
        3. Not changing too fast
        4. Phase balance not too extreme
        """

        # Check 1: No negative power
        if state['setpoint'] > 0 and np.any(action < 0):
            self.log_violation("Negative power when setpoint > 0")
            return False

        # Check 2: Within bounds
        if np.any(action < 0) or np.any(action > self.max_power):
            self.log_violation(f"Action out of bounds: {action}")
            return False

        # Check 3: Rate of change limit
        if self.last_action is not None:
            delta = np.linalg.norm(action - self.last_action)
            if delta > self.max_delta:
                self.log_violation(f"Excessive rate of change: {delta}W")
                return False

        # Check 4: Phase balance
        phase_std = np.std(action)
        if phase_std > 2000:  # 2kW imbalance threshold
            self.log_violation(f"Excessive phase imbalance: {phase_std}W")
            return False

        # All checks passed
        self.last_action = action.copy()
        return True

    def log_violation(self, message):
        """Log safety violation"""
        print(f"[SAFETY] {datetime.now()}: {message}")
```

### Anomaly Detection

```python
class AnomalyDetector:
    def __init__(self, threshold=3.0):
        """
        Detect anomalous states/actions.

        Uses statistical outlier detection (Z-score).
        """
        self.threshold = threshold  # Std devs from mean

        # Load historical statistics
        self.state_mean = None
        self.state_std = None
        self.action_mean = None
        self.action_std = None

        self.load_statistics('data/statistics/normalization_params.json')

    def is_anomalous(self, state, action):
        """
        Check if state or action is anomalous.

        Returns True if either is >3 std devs from historical mean.
        """

        # Z-score for state
        state_z = np.abs((state - self.state_mean) / (self.state_std + 1e-6))
        if np.any(state_z > self.threshold):
            self.log_anomaly(f"Anomalous state detected (max Z={state_z.max():.2f})")
            return True

        # Z-score for action
        action_z = np.abs((action - self.action_mean) / (self.action_std + 1e-6))
        if np.any(action_z > self.threshold):
            self.log_anomaly(f"Anomalous action detected (max Z={action_z.max():.2f})")
            return True

        return False

    def log_anomaly(self, message):
        """Log anomaly detection"""
        print(f"[ANOMALY] {datetime.now()}: {message}")
```

### Monitoring Dashboard

**Metrics to Track:**
```python
metrics_to_monitor = {
    # Performance
    'export_power_W': 'real-time',
    'export_energy_kWh': 'cumulative',
    'reduction_vs_baseline_%': '1-hour rolling',

    # Control
    'action_changes_per_min': '5-min rolling',
    'phase_imbalance_W': 'real-time',
    'controller_in_use': 'categorical (RL/PI)',

    # Safety
    'safety_violations': 'count',
    'anomalies_detected': 'count',
    'fallback_activations': 'count',

    # System
    'inference_latency_ms': 'p50/p95/p99',
    'zigbee_ack_rate_%': '5-min rolling'
}
```

**Alerting:**
- Export increases > 10% vs baseline for 1+ hour → Warning
- Safety violations → Critical alert
- Repeated anomalies → Warning
- Fallback mode active > 24 hours → Warning

---

## Continuous Learning

### Retraining Pipeline

**Trigger retraining when:**
- New data accumulated (weekly/monthly)
- Performance degrades > 5%
- Seasonal changes detected
- System configuration changes (new slaves added)

```bash
# scripts/retrain_model.sh

# 1. Fetch new data from production logs
python scripts/fetch_production_data.py \
    --start_date 2025-11-01 \
    --end_date 2025-11-19 \
    --output_dir data/new_data

# 2. Merge with existing dataset
python preprocessing/merge_datasets.py \
    --existing data/processed/train_dataset.pkl \
    --new data/new_data/processed.pkl \
    --output data/processed/train_dataset_v2.pkl

# 3. Retrain forward model
python training/train_forward_model.py \
    --train_data data/processed/train_dataset_v2.pkl \
    --pretrained_model checkpoints/forward_model/best.pt \
    --output_dir checkpoints/forward_model_v2

# 4. Fine-tune RL policy
python training/finetune_sac.py \
    --train_data data/processed/train_dataset_v2.pkl \
    --pretrained_policy checkpoints/sac_agent/best.pt \
    --forward_model checkpoints/forward_model_v2/best.pt \
    --epochs 100 \
    --output_dir checkpoints/sac_agent_v2

# 5. Validate new model
python evaluation/compare_models.py \
    --old_model checkpoints/sac_agent/best.pt \
    --new_model checkpoints/sac_agent_v2/best.pt \
    --test_data data/processed/test_dataset.pkl

# 6. Deploy new model (if better)
python deployment/update_model.py \
    --new_model checkpoints/sac_agent_v2/best.pt \
    --target production_controller
```

---

## Cost Analysis

### Training Costs

**One-time training:**
- GPU rental (AWS p3.2xlarge): ~$3/hour × 24 hours = **$72**
- Or local GPU (one-time): **$0** (if already owned)

**Ongoing retraining (monthly):**
- Fine-tuning: ~4 hours = **$12/month**

### Deployment Costs

**Hardware:**
- Raspberry Pi 4 or similar: **$50-100** (one-time)
- Or existing master controller: **$0**

**Operating costs:**
- Power consumption: ~5W = **$0.50/month**
- Internet: **$0** (existing connection)

**Total:** <$100 one-time setup + <$15/month ongoing

### Expected Savings

**Assuming:**
- Average export: 10 kWh/day
- RL reduction: 15%
- Electricity rate: $0.15/kWh

**Savings:** 10 × 0.15 × 0.15 = 0.225 kWh/day × 365 = **82 kWh/year**
**Value:** 82 × $0.15 = **$12.30/year**

**Break-even:** ~8 months (if minimal existing infrastructure)
**Break-even:** Immediate (if using existing hardware)

*Note: Actual savings depend on system size, export rates, and RL performance*

---

## Next Steps

1. ✅ Complete planning documents
2. ⏳ Set up development environment
3. ⏳ Extract sample data (1 week) for testing
4. ⏳ Implement data pipeline
5. ⏳ Train forward model
6. ⏳ Train RL agent
7. ⏳ Offline evaluation
8. ⏳ Shadow mode deployment
9. ⏳ A/B testing
10. ⏳ Full deployment

---

## Appendix: Deployment Checklist

### Pre-Deployment
- [ ] Forward model trained and validated (test MSE < 0.1)
- [ ] RL policy trained and validated (export reduction ≥ 10%)
- [ ] Safety checker implemented and tested
- [ ] Anomaly detector calibrated on historical data
- [ ] Fallback PI controller tested
- [ ] Monitoring dashboard configured
- [ ] Alert thresholds set
- [ ] Deployment hardware provisioned
- [ ] Network connectivity verified

### Shadow Mode
- [ ] Shadow mode running for 1 week minimum
- [ ] No safety violations detected
- [ ] RL predictions stable and reasonable
- [ ] Latency < 100ms consistently
- [ ] Logs reviewed by engineer

### A/B Testing
- [ ] A/B schedule defined
- [ ] Metrics baseline established
- [ ] Comparison analysis implemented
- [ ] Rollback procedure tested
- [ ] Running for 1 week minimum

### Full Deployment
- [ ] Gradual rollout plan defined
- [ ] Rollback triggers configured
- [ ] On-call engineer assigned
- [ ] Performance monitoring active
- [ ] Retraining pipeline ready

### Post-Deployment
- [ ] Weekly performance review
- [ ] Monthly retraining evaluation
- [ ] Quarterly cost-benefit analysis
- [ ] Semi-annual model audit
