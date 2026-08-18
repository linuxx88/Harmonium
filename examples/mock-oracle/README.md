# Development Mock Oracle

This directory provides a standalone, development-only mock oracle generator for the Harmonium protocol.

## Features
- Generates ephemeral local oracle keypairs.
- Constructs valid EIP-712 typed data messages according to `HarmoniumPayEscrow.sol`.
- Produces 2-of-3 threshold signature bundles for testing settlement flows locally.

## Usage
```bash
python3 mock_oracle.py
```
