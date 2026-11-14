from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MonitoredService(Base):
    """An approved service whose health may be checked."""

    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, server_default="")
    target_url: Mapped[str] = mapped_column(Text)
    expected_status_code: Mapped[int] = mapped_column(Integer, server_default="200")
    timeout_ms: Mapped[int] = mapped_column(Integer, server_default="3000")
    degraded_threshold_ms: Mapped[int] = mapped_column(Integer, server_default="1000")
    is_enabled: Mapped[bool] = mapped_column(server_default=text("true"))
    is_demo_seed: Mapped[bool] = mapped_column(server_default=text("false"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
