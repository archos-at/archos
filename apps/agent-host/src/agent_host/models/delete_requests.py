from pydantic import BaseModel
from pydantic import Field


class DocumentToDelete(BaseModel):
    id: str = Field(..., min_length=1, description="The workspace document's id (`documents.id`)")
    file_name: str = Field(..., min_length=1, description="The name its chunks are stored under")


class DeleteFilesRequest(BaseModel):
    file_ids: list[str] = Field(..., description="List of file IDs to delete")
    documents: list[DocumentToDelete] = Field(
        default_factory=list,
        description=(
            "Workspace documents to delete by id. When given, `file_ids` is ignored: it is the same files by "
            "name, sent for a backend that does not read `documents` yet."
        ),
    )
    permanent: bool = Field(
        False,
        description=(
            "True when nobody will undo this delete (an erase, a move to another collection): the Fassung facts "
            "a person made on the files go with them. False (the default) keeps those facts for the files' "
            "return after an archive, the folder bin or a publish."
        ),
    )
