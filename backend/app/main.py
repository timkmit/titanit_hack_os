from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.audit import router as audit_router
from app.api.routes.health import router as health_router
from app.api.routes.system import router as system_router
from app.core.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with httpx.AsyncClient() as client:
        app.state.http_client = client
        yield


settings = get_settings()

app = FastAPI(
    title=settings.project_name,
    version=settings.project_version,
    description=settings.project_description,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(system_router)
app.include_router(audit_router)
