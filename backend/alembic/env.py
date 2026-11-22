from alembic import context

from app import models  # Register business entities.
from app.db import Base, engine, sqlite_url

try:
    from app.ai import models as ai_models
except ModuleNotFoundError as exc:
    if exc.name not in {"app.ai", "app.ai.models"}:
        raise

if context.is_offline_mode():
    context.configure(url=sqlite_url(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
