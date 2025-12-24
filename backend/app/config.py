from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CR_", extra="ignore")

    environment: str = "local"

    database_url: str = "postgresql+asyncpg://postgres:kush2464@127.0.0.1:5432/conversationrelay"

    llm_provider: str = "mock"  # mock | ollama
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.1"


settings = Settings()
