from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.services.page_extract import extract_page

router = APIRouter()


class PageExtractResponse(BaseModel):
    url: str
    kind: str = Field(description="html | youtube")
    title: str | None = None
    text: str | None = Field(default=None, description="Main article or video description")
    comments: list[str] = Field(default_factory=list)
    note: str | None = Field(default=None, description="Hints or extractor errors")


@router.get("/page-extract", response_model=PageExtractResponse)
async def page_extract_endpoint(
    request: Request,
    url: str = Query(..., min_length=8, max_length=2048, description="Target page URL (encoded)"),
) -> PageExtractResponse:
    """
    Machine-oriented extraction for OpenClaw `web_fetch`.

    Pass the **user's page URL** as query `url` (encoded). Example for the agent:
    `http://api:8000/api/tools/page-extract?url=https%3A%2F%2F...`
    """
    client = request.app.state.http_client
    result = await extract_page(client, url)
    return PageExtractResponse(
        url=result.url,
        kind=result.kind,
        title=result.title,
        text=result.text,
        comments=result.comments,
        note=result.note,
    )
