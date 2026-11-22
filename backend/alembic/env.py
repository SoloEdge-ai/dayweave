from alembic import context

from app import models  # Register business entities.
from app.db import Base, engine, sqlite_url

try:
    from app.ai import models as ai_models
except ModuleNotFoundError as exc:
    if exc.name not in {"app.ai", "app.ai.models"}:
        raise

def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(url=sqlite_url(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
elif context.config.attributes.get("connection") is not None:
    migrate(context.config.attributes["connection"])
else:
    with engine.connect() as connection:
        migrate(connection)
