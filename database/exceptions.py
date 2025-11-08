"""Custom exceptions for database access layers."""

class SessionNotFoundError(Exception):
    """Raised when a pipeline session cannot be located."""


class ModuleResultNotFoundError(Exception):
    """Raised when a module result is missing for a given session."""
