# RL Data Pipeline Design

## Overview

This document details the data preprocessing and feature engineering pipeline for training the RL-based energy export minimization system.

**Input:** Raw logs (~40GB) from meter, Zigbee, PI controller
**Output:** Clean (state, action, reward, next_state) tuples ready for RL training

---

## Data Sources & Schema

### 1. 3-Phase Meter Readings

**Sampling Rate:** ~1 Hz (assumed)
**Data Volume:** Largest component of 40GB

```python
MeterReading = {
    'timestamp': datetime,

    # Grid Power (per phase)
    'grid_power_a': float,  # W
    'grid_power_b': float,  # W
    'grid_power_c': float,  # W
    'grid_power_total': float,  # W (total export/import)

    # Grid Voltage (per phase)
    'grid_voltage_a': float,  # V
    'grid_voltage_b': float,  # V
    'grid_voltage_c': float,  # V

    # Grid Current (per phase)
    'grid_current_a': float,  # A
    'grid_current_b': float,  # A
    'grid_current_c': float,  # A

    # Cumulative Energy (per phase)
    'import_kwh_a': float,
    'import_kwh_b': float,
    'import_kwh_c': float,
    'export_kwh_a': float,
    'export_kwh_b': float,
    'export_kwh_c': float,

    # PV Generation
    'pv_power': float,  # W
    'pv_voltage': float,  # V

    # Other
    'frequency': float,  # Hz
    'temperature': float  # °C
}
```

### 2. Zigbee Broadcast Commands

**Sampling Rate:** Irregular (on-demand)
**Structure:** 2D array of integers

```python
ZigbeeCommand = {
    'timestamp': datetime,

    # Command payload: [[phase_a_slaves], [phase_b_slaves], [phase_c_slaves]]
    'command': List[List[int]],

    # Example:
    # [[1500, 1500, 1500],  # Phase A: 3 slaves @ 1500W each
    #  [2000, 2000],        # Phase B: 2 slaves @ 2000W each
    #  [1000, 1000, 1000, 1000]]  # Phase C: 4 slaves @ 1000W each

    'target_devices': List[str],  # Device IDs
    'ack_received': bool,  # Command acknowledged?
    'ack_timestamp': datetime  # When ack received
}
```

### 3. PI Controller State

**Sampling Rate:** ~1 Hz (matches meter readings)

```python
PIState = {
    'timestamp': datetime,

    'reference_power': float,  # Target/setpoint (W)
    'error': float,  # reference - actual
    'proportional_term': float,  # Kp * error
    'integral_term': float,  # Ki * ∫error dt
    'output': float,  # PI output

    # PI parameters (may be constant)
    'kp': float,
    'ki': float
}
```

### 4. Slave AC Power Output (FUTURE)

**Availability:** Coming soon
**Sampling Rate:** TBD

```python
SlaveOutput = {
    'timestamp': datetime,

    # Per-slave power consumption
    'slave_power': {
        'phase_a': List[float],  # [slave1_W, slave2_W, ...]
        'phase_b': List[float],
        'phase_c': List[float]
    },

    # Latency metrics
    'command_to_response_latency': float  # seconds
}
```

---

## Data Loading

### Step 1: Load Raw Data

```python
import pandas as pd
import numpy as np
from pathlib import Path

class DataLoader:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    def load_meter_data(self) -> pd.DataFrame:
        """Load 3-phase meter readings"""
        # Assuming CSV or Parquet format
        df = pd.read_csv(self.data_dir / 'meter_readings.csv', parse_dates=['timestamp'])
        df = df.sort_values('timestamp')
        return df

    def load_zigbee_commands(self) -> pd.DataFrame:
        """Load Zigbee broadcast command logs"""
        df = pd.read_csv(self.data_dir / 'zigbee_commands.csv', parse_dates=['timestamp'])

        # Parse command payload (may be stored as JSON string)
        import json
        df['command'] = df['command_json'].apply(json.loads)

        return df

    def load_pi_state(self) -> pd.DataFrame:
        """Load PI controller state"""
        df = pd.read_csv(self.data_dir / 'pi_state.csv', parse_dates=['timestamp'])
        return df

    def load_all(self) -> dict:
        """Load all data sources"""
        return {
            'meter': self.load_meter_data(),
            'zigbee': self.load_zigbee_commands(),
            'pi': self.load_pi_state()
        }
```

### Step 2: Data Quality Checks

```python
class DataValidator:
    def __init__(self, data: dict):
        self.data = data

    def check_timestamps(self):
        """Ensure timestamps are monotonic and reasonable"""
        for name, df in self.data.items():
            assert df['timestamp'].is_monotonic_increasing, f"{name}: Non-monotonic timestamps"

            # Check for reasonable date range (not in future, not too old)
            now = pd.Timestamp.now()
            assert (df['timestamp'] <= now).all(), f"{name}: Future timestamps found"
            assert (df['timestamp'] >= now - pd.Timedelta(days=365)).all(), f"{name}: Very old timestamps"

    def check_missing_values(self):
        """Check for missing values"""
        for name, df in self.data.items():
            missing = df.isnull().sum()
            if missing.any():
                print(f"{name} missing values:\n{missing[missing > 0]}")

    def check_value_ranges(self):
        """Check for unrealistic values"""
        meter = self.data['meter']

        # Power should be reasonable (e.g., -100kW to +100kW)
        assert (meter['grid_power_total'].abs() < 100000).all(), "Unrealistic power values"

        # Voltage should be reasonable (e.g., 200-260V per phase)
        for phase in ['a', 'b', 'c']:
            v = meter[f'grid_voltage_{phase}']
            assert (v >= 200).all() and (v <= 260).all(), f"Unrealistic voltage on phase {phase}"

        # Frequency should be ~60Hz (or 50Hz for EU)
        assert (meter['frequency'] >= 59).all() and (meter['frequency'] <= 61).all(), "Unrealistic frequency"

    def check_data_completeness(self):
        """Check for large gaps in data"""
        for name, df in self.data.items():
            time_gaps = df['timestamp'].diff()
            large_gaps = time_gaps > pd.Timedelta(minutes=5)

            if large_gaps.any():
                print(f"Warning: {name} has {large_gaps.sum()} gaps > 5 minutes")
                print(f"  Largest gap: {time_gaps.max()}")

    def validate_all(self):
        """Run all validation checks"""
        print("Running data validation...")
        self.check_timestamps()
        self.check_missing_values()
        self.check_value_ranges()
        self.check_data_completeness()
        print("Validation complete ✓")
```

---

## Data Preprocessing

### Step 3: Timestamp Alignment

**Challenge:** Different data sources have different sampling rates
- Meter readings: ~1 Hz (regular)
- Zigbee commands: Irregular (only when commands sent)
- PI state: ~1 Hz (regular, aligned with meter)

**Solution:** Resample to common timestep and forward-fill irregular data

```python
class DataAligner:
    def __init__(self, resample_freq='1S'):
        self.freq = resample_freq  # '1S' = 1 second

    def align_timeseries(self, data: dict) -> pd.DataFrame:
        """Align all data sources to common timestamps"""

        # 1. Resample meter data (regular)
        meter = data['meter'].set_index('timestamp')
        meter_resampled = meter.resample(self.freq).mean()

        # 2. Resample PI state (regular)
        pi = data['pi'].set_index('timestamp')
        pi_resampled = pi.resample(self.freq).mean()

        # 3. Resample Zigbee commands (irregular - forward fill)
        zigbee = data['zigbee'].set_index('timestamp')
        zigbee_resampled = zigbee.resample(self.freq).ffill()  # Repeat last command

        # 4. Merge all sources
        aligned = meter_resampled.join(pi_resampled, how='inner', rsuffix='_pi')
        aligned = aligned.join(zigbee_resampled, how='left', rsuffix='_zigbee')

        # 5. Fill NaNs for periods before first Zigbee command
        aligned['command'] = aligned['command'].fillna(method='bfill', limit=10)

        # 6. Reset index to make timestamp a column again
        aligned = aligned.reset_index()

        return aligned

    def compute_command_age(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute time since last command was sent"""

        # Find rows where command changed
        df['command_str'] = df['command'].astype(str)  # Convert to string for comparison
        command_changed = df['command_str'] != df['command_str'].shift(1)

        # Mark timestamp of each command change
        df['last_command_time'] = None
        df.loc[command_changed, 'last_command_time'] = df.loc[command_changed, 'timestamp']

        # Forward fill command timestamps
        df['last_command_time'] = pd.to_datetime(df['last_command_time'])
        df['last_command_time'] = df['last_command_time'].fillna(method='ffill')

        # Compute age
        df['command_age_seconds'] = (df['timestamp'] - df['last_command_time']).dt.total_seconds()

        return df
```

### Step 4: Feature Engineering

```python
class FeatureEngineer:
    def __init__(self):
        pass

    def add_rolling_features(self, df: pd.DataFrame, windows=[5, 10, 30]) -> pd.DataFrame:
        """Add rolling statistics to capture trends"""

        for window in windows:
            # Rolling mean
            df[f'export_ma_{window}s'] = df['grid_power_total'].rolling(window).mean()

            # Rolling std (volatility)
            df[f'export_std_{window}s'] = df['grid_power_total'].rolling(window).std()

            # Rolling min/max
            df[f'export_min_{window}s'] = df['grid_power_total'].rolling(window).min()
            df[f'export_max_{window}s'] = df['grid_power_total'].rolling(window).max()

        return df

    def add_derivative_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add rate of change features"""

        # Time delta (should be ~1 second if resampled properly)
        dt = df['timestamp'].diff().dt.total_seconds()

        # Rate of change of export power
        df['dP_dt'] = df['grid_power_total'].diff() / dt

        # Acceleration (second derivative)
        df['d2P_dt2'] = df['dP_dt'].diff() / dt

        # Rate of change per phase
        for phase in ['a', 'b', 'c']:
            df[f'dP{phase}_dt'] = df[f'grid_power_{phase}'].diff() / dt

        return df

    def add_temporal_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add time-based features"""

        # Hour of day (0-23)
        df['hour'] = df['timestamp'].dt.hour

        # Minute of hour (0-59)
        df['minute'] = df['timestamp'].dt.minute

        # Day of week (0=Monday, 6=Sunday)
        df['day_of_week'] = df['timestamp'].dt.dayofweek

        # Is weekend?
        df['is_weekend'] = df['day_of_week'] >= 5

        # Cyclical encoding (better for neural networks)
        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)

        return df

    def add_command_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add features related to Zigbee commands"""

        # Total power commanded (sum across all slaves)
        def sum_command(cmd):
            if isinstance(cmd, list):
                return sum([sum(phase) for phase in cmd])
            return 0

        df['command_total_power'] = df['command'].apply(sum_command)

        # Power per phase
        def extract_phase_power(cmd, phase_idx):
            if isinstance(cmd, list) and len(cmd) > phase_idx:
                return sum(cmd[phase_idx])
            return 0

        df['command_phase_a'] = df['command'].apply(lambda c: extract_phase_power(c, 0))
        df['command_phase_b'] = df['command'].apply(lambda c: extract_phase_power(c, 1))
        df['command_phase_c'] = df['command'].apply(lambda c: extract_phase_power(c, 2))

        # Number of active slaves per phase
        def count_slaves(cmd, phase_idx):
            if isinstance(cmd, list) and len(cmd) > phase_idx:
                return len(cmd[phase_idx])
            return 0

        df['slaves_phase_a'] = df['command'].apply(lambda c: count_slaves(c, 0))
        df['slaves_phase_b'] = df['command'].apply(lambda c: count_slaves(c, 1))
        df['slaves_phase_c'] = df['command'].apply(lambda c: count_slaves(c, 2))
        df['slaves_total'] = df['slaves_phase_a'] + df['slaves_phase_b'] + df['slaves_phase_c']

        return df

    def add_pi_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add PI controller context features"""

        # PI error (already in data, but can add derived features)
        df['pi_error_abs'] = df['error'].abs()

        # PI output change
        df['pi_output_change'] = df['output'].diff()

        return df

    def engineer_all(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply all feature engineering steps"""
        print("Engineering features...")

        df = self.add_rolling_features(df)
        df = self.add_derivative_features(df)
        df = self.add_temporal_features(df)
        df = self.add_command_features(df)
        df = self.add_pi_features(df)

        # Drop NaNs created by rolling/diff operations
        initial_len = len(df)
        df = df.dropna()
        print(f"Dropped {initial_len - len(df)} rows due to NaN values")

        return df
```

---

## RL Dataset Creation

### Step 5: Extract States, Actions, Rewards

```python
class RLDatasetBuilder:
    def __init__(self, lookahead_seconds=5):
        self.lookahead = lookahead_seconds

    def extract_state(self, row: pd.Series) -> np.ndarray:
        """Extract state vector from dataframe row"""

        state_features = [
            # Grid power
            row['grid_power_total'],
            row['grid_power_a'],
            row['grid_power_b'],
            row['grid_power_c'],

            # Grid voltage
            row['grid_voltage_a'],
            row['grid_voltage_b'],
            row['grid_voltage_c'],

            # Grid current
            row['grid_current_a'],
            row['grid_current_b'],
            row['grid_current_c'],

            # PV generation
            row['pv_power'],

            # Rolling features
            row['export_ma_5s'],
            row['export_std_5s'],
            row['dP_dt'],

            # Command history
            row['command_total_power'],
            row['command_phase_a'],
            row['command_phase_b'],
            row['command_phase_c'],
            row['command_age_seconds'],

            # PI state
            row['reference_power'],
            row['error'],
            row['pi_output'],

            # Temporal
            row['hour_sin'],
            row['hour_cos'],
            row['day_of_week'],

            # System state
            row['slaves_total'],
            row['slaves_phase_a'],
            row['slaves_phase_b'],
            row['slaves_phase_c']
        ]

        return np.array(state_features, dtype=np.float32)

    def extract_action(self, row: pd.Series) -> np.ndarray:
        """Extract action vector from dataframe row"""

        # Action = commanded power per phase
        action = np.array([
            row['command_phase_a'],
            row['command_phase_b'],
            row['command_phase_c']
        ], dtype=np.float32)

        return action

    def compute_reward(self, state: np.ndarray, action: np.ndarray, next_state: np.ndarray,
                       prev_action: np.ndarray = None) -> float:
        """Compute reward for transition"""

        # Extract relevant state components (indices depend on extract_state)
        export_power = next_state[0]  # grid_power_total
        phase_powers = next_state[1:4]  # grid_power_a/b/c

        # Primary objective: minimize export (negative reward for exporting)
        export_penalty = -max(0, export_power) / 1000  # Scale to reasonable range

        # Oscillation penalty
        if prev_action is not None:
            action_change = np.linalg.norm(action - prev_action)
            oscillation_penalty = -0.1 * action_change / 1000
        else:
            oscillation_penalty = 0

        # Phase imbalance penalty (optional - can be enabled/disabled)
        phase_std = np.std(phase_powers)
        imbalance_penalty = -0.05 * phase_std / 1000

        # Safety penalty: negative commands
        negative_penalty = -1000 * np.sum(action < 0)

        # Total reward
        reward = export_penalty + oscillation_penalty + imbalance_penalty + negative_penalty

        return reward

    def build_dataset(self, df: pd.DataFrame) -> list:
        """Build RL dataset with lookahead for delayed effects"""

        dataset = []

        for i in range(len(df) - self.lookahead):
            # Current state and action
            state = self.extract_state(df.iloc[i])
            action = self.extract_action(df.iloc[i])

            # Next state (after delay)
            next_state = self.extract_state(df.iloc[i + self.lookahead])

            # Previous action (for oscillation penalty)
            if i > 0:
                prev_action = self.extract_action(df.iloc[i - 1])
            else:
                prev_action = None

            # Compute reward
            reward = self.compute_reward(state, action, next_state, prev_action)

            # Add to dataset
            dataset.append({
                'state': state,
                'action': action,
                'reward': reward,
                'next_state': next_state,
                'done': False,  # Continuous task
                'timestamp': df.iloc[i]['timestamp']  # For debugging
            })

        return dataset

    def save_dataset(self, dataset: list, output_path: Path):
        """Save dataset to disk"""
        import pickle

        with open(output_path, 'wb') as f:
            pickle.dump(dataset, f)

        print(f"Saved {len(dataset)} transitions to {output_path}")
```

---

## Train/Val/Test Split

```python
class DatasetSplitter:
    def __init__(self, train_ratio=0.7, val_ratio=0.15, test_ratio=0.15):
        assert train_ratio + val_ratio + test_ratio == 1.0
        self.train_ratio = train_ratio
        self.val_ratio = val_ratio
        self.test_ratio = test_ratio

    def split_temporal(self, dataset: list) -> dict:
        """
        Split dataset temporally (IMPORTANT: don't shuffle!)

        RL datasets should be split by time to avoid leakage:
        - Train: earliest 70%
        - Val: next 15%
        - Test: latest 15%
        """

        n = len(dataset)
        train_end = int(n * self.train_ratio)
        val_end = int(n * (self.train_ratio + self.val_ratio))

        splits = {
            'train': dataset[:train_end],
            'val': dataset[train_end:val_end],
            'test': dataset[val_end:]
        }

        print(f"Train: {len(splits['train'])} samples")
        print(f"Val:   {len(splits['val'])} samples")
        print(f"Test:  {len(splits['test'])} samples")

        return splits
```

---

## Complete Pipeline

```python
def main():
    # Paths
    data_dir = Path('/path/to/raw/data')
    output_dir = Path('/path/to/processed/data')
    output_dir.mkdir(exist_ok=True)

    # 1. Load data
    print("=" * 50)
    print("STEP 1: Loading data...")
    print("=" * 50)
    loader = DataLoader(data_dir)
    data = loader.load_all()

    # 2. Validate data quality
    print("\n" + "=" * 50)
    print("STEP 2: Validating data...")
    print("=" * 50)
    validator = DataValidator(data)
    validator.validate_all()

    # 3. Align timestamps
    print("\n" + "=" * 50)
    print("STEP 3: Aligning timestamps...")
    print("=" * 50)
    aligner = DataAligner(resample_freq='1S')
    aligned = aligner.align_timeseries(data)
    aligned = aligner.compute_command_age(aligned)
    print(f"Aligned dataset shape: {aligned.shape}")

    # 4. Engineer features
    print("\n" + "=" * 50)
    print("STEP 4: Engineering features...")
    print("=" * 50)
    engineer = FeatureEngineer()
    features = engineer.engineer_all(aligned)
    print(f"Feature dataset shape: {features.shape}")
    print(f"Feature columns: {features.columns.tolist()}")

    # 5. Build RL dataset
    print("\n" + "=" * 50)
    print("STEP 5: Building RL dataset...")
    print("=" * 50)
    builder = RLDatasetBuilder(lookahead_seconds=5)
    dataset = builder.build_dataset(features)

    # 6. Split dataset
    print("\n" + "=" * 50)
    print("STEP 6: Splitting dataset...")
    print("=" * 50)
    splitter = DatasetSplitter()
    splits = splitter.split_temporal(dataset)

    # 7. Save processed data
    print("\n" + "=" * 50)
    print("STEP 7: Saving processed data...")
    print("=" * 50)
    for split_name, split_data in splits.items():
        output_path = output_dir / f'{split_name}_dataset.pkl'
        builder.save_dataset(split_data, output_path)

    # 8. Summary statistics
    print("\n" + "=" * 50)
    print("PIPELINE COMPLETE - Summary Statistics")
    print("=" * 50)

    # Analyze reward distribution
    rewards = [t['reward'] for t in dataset]
    print(f"Reward statistics:")
    print(f"  Mean: {np.mean(rewards):.2f}")
    print(f"  Std:  {np.std(rewards):.2f}")
    print(f"  Min:  {np.min(rewards):.2f}")
    print(f"  Max:  {np.max(rewards):.2f}")

    # Analyze state/action ranges
    states = np.array([t['state'] for t in dataset])
    actions = np.array([t['action'] for t in dataset])

    print(f"\nState statistics:")
    print(f"  Shape: {states.shape}")
    print(f"  Mean: {states.mean(axis=0)[:5]}...")  # First 5 features
    print(f"  Std:  {states.std(axis=0)[:5]}...")

    print(f"\nAction statistics:")
    print(f"  Shape: {actions.shape}")
    print(f"  Mean: {actions.mean(axis=0)}")
    print(f"  Std:  {actions.std(axis=0)}")
    print(f"  Min:  {actions.min(axis=0)}")
    print(f"  Max:  {actions.max(axis=0)}")

if __name__ == '__main__':
    main()
```

---

## Next Steps

1. **Adapt to actual data format:** Update loaders based on real schema
2. **Validate on sample data:** Run pipeline on small subset
3. **Tune hyperparameters:** Adjust rolling windows, lookahead time, reward weights
4. **Add slave feedback:** Once available, integrate per-slave AC power data
5. **Normalization:** Add feature normalization before training

## Notes

- **Memory efficiency:** For 40GB dataset, consider chunked processing
- **Parallelization:** Use multiprocessing for feature engineering
- **Caching:** Save intermediate results (aligned data, features) to avoid recomputation
- **Versioning:** Track data pipeline version alongside model versions
