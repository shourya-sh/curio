from pydantic import BaseModel


class LinkCreate(BaseModel):
    parent_id: int
    child_id: int
