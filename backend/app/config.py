from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CR_", extra="ignore")

    environment: str = "local"

    database_url: str = "postgresql+asyncpg://postgres:kush7824@127.0.0.1:5432/conversationrelay"

    llm_provider: str = "mock"  # mock | ollama | openai | gemini
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.1"

    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    gemini_api_key: str | None = None
    gemini_base_url: str = "https://generativelanguage.googleapis.com"
    gemini_model: str = "gemini-1.5-flash"


settings = Settings()
