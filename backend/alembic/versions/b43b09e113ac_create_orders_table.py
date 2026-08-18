"""create_orders_table

Revision ID: b43b09e113ac
Revises: 
Create Date: 2026-08-15 17:38:58.336209

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b43b09e113ac'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'orders',
        sa.Column('order_id', sa.String(), primary_key=True),
        sa.Column('session_id', sa.String(), unique=True, nullable=False),
        sa.Column('buyer', sa.String(), nullable=False),
        sa.Column('seller', sa.String(), nullable=False),
        sa.Column('item_price', sa.BigInteger(), nullable=False),
        sa.Column('gross_amount', sa.BigInteger(), nullable=False),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('contract_address', sa.String(), nullable=False),
        sa.Column('chain_id', sa.Integer(), nullable=False),
        sa.Column('tracking_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('nonce', sa.BigInteger(), nullable=True),
        sa.Column('voucher_deadline', sa.BigInteger(), nullable=True),
        sa.Column('signatures', sa.Text(), nullable=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('orders')

