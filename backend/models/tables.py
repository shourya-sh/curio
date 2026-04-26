from sqlalchemy import Column, String, Integer, BigInteger, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime


class Base(DeclarativeBase):
    pass


class SessionTable(Base):
    __tablename__ = "sessions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=True)
    title = Column(String(255), nullable=False)
    mode = Column(String(10), nullable=False, default="research")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    nodes = relationship("NodeTable", back_populates="session", cascade="all, delete-orphan")
    links = relationship("NodeLinkTable", back_populates="session", cascade="all, delete-orphan")
    messages = relationship("MessageTable", back_populates="session", cascade="all, delete-orphan")


class NodeTable(Base):
    __tablename__ = "nodes"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(BigInteger, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    topic = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    details = Column(Text, nullable=True)
    subtopics = Column(JSONB, default=list)
    depth = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("SessionTable", back_populates="nodes")
    parent_links = relationship("NodeLinkTable", foreign_keys="NodeLinkTable.child_id", back_populates="child", cascade="all, delete-orphan")
    child_links = relationship("NodeLinkTable", foreign_keys="NodeLinkTable.parent_id", back_populates="parent", cascade="all, delete-orphan")


class NodeLinkTable(Base):
    __tablename__ = "node_links"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(BigInteger, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(BigInteger, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    child_id = Column(BigInteger, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    session = relationship("SessionTable", back_populates="links")
    parent = relationship("NodeTable", foreign_keys=[parent_id])
    child = relationship("NodeTable", foreign_keys=[child_id])


class MessageTable(Base):
    __tablename__ = "messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(BigInteger, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(10), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    session = relationship("SessionTable", back_populates="messages")
