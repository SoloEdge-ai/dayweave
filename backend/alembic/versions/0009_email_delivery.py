"""Track whether the relay has accepted a verification code."""
import sqlalchemy as sa
from alembic import op

revision = "0009_email_delivery"
down_revision = "0008_email_identity"
branch_labels = None
depends_on = None


def upgrade():
    if not op.get_context().config.attributes.get("workspace"):
        op.add_column("email_challenges", sa.Column("delivery_state", sa.String(16), nullable=False,
                                                   server_default="submitted"))


def downgrade():
    if not op.get_context().config.attributes.get("workspace"):
        op.drop_column("email_challenges", "delivery_state")
