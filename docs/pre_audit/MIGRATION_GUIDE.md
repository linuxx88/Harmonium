# Database Migration & Persistence Guide - Harmonium Pay

## Overview
The Harmonium Pay backend supports both local embedded SQLite storage (development / PoC) and production-grade PostgreSQL with schema versioning via **Alembic**.

---

## Alembic Migration Workflow

### 1. Environment Setup
Make sure the Python virtual environment is activated:
```bash
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 2. Apply Migrations
To upgrade the database schema to the latest version:
```bash
alembic upgrade head
```

To rollback the last migration:
```bash
alembic downgrade -1
```

### 3. Creating New Schema Migrations
```bash
alembic revision -m "add_column_name_to_orders"
```

---

## SQLite to PostgreSQL Migration Procedure

### Step 1: PostgreSQL Connection Setup
Set the `DATABASE_URL` environment variable:
```bash
export DATABASE_URL="postgresql+psycopg2://harmonium_user:secure_password@localhost:5432/harmonium_pay"
```

In `alembic.ini`, update or pass via environment:
```ini
sqlalchemy.url = ${DATABASE_URL}
```

### Step 2: Schema Initialization in PostgreSQL
Run Alembic against PostgreSQL:
```bash
alembic upgrade head
```

### Step 3: Data Migration Script (SQLite -> PostgreSQL)
```python
import sqlite3
import psycopg2

sqlite_conn = sqlite3.connect("backend/harmonium_pay.db")
pg_conn = psycopg2.connect("postgresql://harmonium_user:secure_password@localhost:5432/harmonium_pay")

s_cur = sqlite_conn.cursor()
p_cur = pg_conn.cursor()

s_cur.execute("SELECT * FROM orders")
rows = s_cur.fetchall()

insert_query = """
INSERT INTO orders (order_id, session_id, buyer, seller, item_price, gross_amount, token, contract_address, chain_id, tracking_id, status, nonce, voucher_deadline, signatures, created_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (order_id) DO NOTHING;
"""

p_cur.executemany(insert_query, rows)
pg_conn.commit()
print(f"Successfully migrated {len(rows)} orders from SQLite to PostgreSQL.")
```
