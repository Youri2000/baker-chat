"""应用配置：用 pydantic-settings 从环境变量 / .env 读取，导出全局单例 settings 供各模块引用。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 固定读取 backend/.env：相对路径依赖启动目录，从仓库根目录启动时会静默忽略
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """后端运行配置，字段与 docs/api.md 第 7 节的环境变量一一对应。"""

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8")

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"
    database_url: str = "sqlite:///./data/baker.db"
    jwt_secret: str  # 必填：缺失时 Settings() 抛 ValidationError，启动即失败
    cors_origins: str = "http://localhost:5173"  # 逗号分隔的白名单
    daily_message_limit: int = 100
    demo_username: str = "demo"
    demo_password: str = "demo123"
    ai_mock: bool = False  # 为真时不请求上游，发送固定假回复


settings = Settings()
