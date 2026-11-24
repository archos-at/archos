from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


KEY_DOCUMENTS_PREFIX = "status.documents."


KEY_DOCUMENTS_WAITING = "status.documents.waiting"


KEY_RETRIEVAL_WITH_QUERY = "status.retrieval.withQuery"


KEY_RETRIEVAL_PLAIN = "status.retrieval.plain"


KEY_RETRIEVAL_CLAUSE = "status.retrieval.clause"


KEY_RETRIEVAL_PAGE = "status.retrieval.page"


KEY_RETRIEVAL_REQUERY = "status.retrieval.requery"


KEY_ACTION_REMEMBER = "status.action.remember"


KEY_ACTION_CARD = "status.action.card"


KEY_ACTION_DRAFT_LIST = "status.action.draftList"


KEY_ACTION_DRAFT_READ = "status.action.draftRead"


KEY_ACTION_DRAFT_WRITE = "status.action.draftWrite"


KEY_ACTION_DRAFT_EDIT = "status.action.draftEdit"


KEY_ACTION_FILE_PROPOSAL = "status.action.fileProposal"


KEY_ACTION_DRAFT_FILED = "status.action.draftFiled"


KEY_ACTION_CODE_RUN = "status.action.codeRun"


KEY_ACTION_FILE_MAKE = "status.action.fileMake"


KEY_ACTION_FILES_MAKE = "status.action.filesMake"


KEY_ACTION_FILE_EDIT = "status.action.fileEdit"


KEY_ACTION_FILE_CHECK = "status.action.fileCheck"


KEY_ACTION_FILE_RETRY = "status.action.fileRetry"


KEY_ACTION_CALCULATION = "status.action.calculation"


KEY_ACTION_TASK_CREATED = "status.action.taskCreated"


KEY_ACTION_ANNOTATIONS_READ = "status.action.annotationsRead"


KEY_ACTION_ANNOTATIONS_PROPOSE = "status.action.annotationsPropose"


KEY_ACTION_ANNOTATIONS_SET = "status.action.annotationsSet"


KEY_ACTION_ANNOTATIONS_UPDATE = "status.action.annotationsUpdate"


KEY_ACTION_ANNOTATIONS_DELETE = "status.action.annotationsDelete"


KEY_ACTION_ANNOTATIONS_REPLY = "status.action.annotationsReply"


KEY_ACTION_LOOK = "status.action.look"


KEY_ACTION_WORKSPACE_CALL = "status.action.workspaceCall"


KEY_CITATIONS = "status.citations"


KEY_REPAIR = "status.repair"


KEY_ESCALATION = "status.escalation"


KEY_SYNTHESIS = "status.synthesis"


ALL_STATUS_KEYS: tuple[str, ...] = (
    "status.documents.officeShelf",
    "status.documents.project",
    "status.documents.session",
    "status.documents.several",
    "status.documents.waiting",
    "status.retrieval.withQuery",
    "status.retrieval.plain",
    "status.retrieval.clause",
    "status.retrieval.page",
    "status.retrieval.requery",
    "status.action.remember",
    "status.action.card",
    "status.action.draftList",
    "status.action.draftRead",
    "status.action.draftWrite",
    "status.action.draftEdit",
    "status.action.fileProposal",
    "status.action.draftFiled",
    "status.action.codeRun",
    "status.action.fileMake",
    "status.action.filesMake",
    "status.action.fileEdit",
    "status.action.fileCheck",
    "status.action.fileRetry",
    "status.action.calculation",
    "status.action.taskCreated",
    "status.action.annotationsRead",
    "status.action.annotationsPropose",
    "status.action.annotationsSet",
    "status.action.annotationsUpdate",
    "status.action.annotationsDelete",
    "status.action.annotationsReply",
    "status.action.look",
    "status.action.workspaceCall",
    "status.citations",
    "status.repair",
    "status.escalation",
    "status.synthesis",
)
