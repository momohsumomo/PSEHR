from contextvars import ContextVar

current_machine_id: ContextVar[str] = ContextVar("current_machine_id", default="Unknown_Machine")
current_operator_identity: ContextVar[str] = ContextVar("current_operator_identity", default="System_Collaborative")
current_pin_code: ContextVar[str | None] = ContextVar("current_pin_code", default=None)
