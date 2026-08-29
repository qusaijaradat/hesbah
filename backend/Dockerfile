# Multi-stage build for the ASP.NET Core Web API.
# NOTE: this needs a normal internet connection to nuget.org at build time to restore
# packages — see docs/DEVELOPMENT_NOTES.md for why that couldn't be verified in the
# sandbox that generated this project.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY src/GreenMarket.Domain/GreenMarket.Domain.csproj GreenMarket.Domain/
COPY src/GreenMarket.Infrastructure/GreenMarket.Infrastructure.csproj GreenMarket.Infrastructure/
COPY src/GreenMarket.Api/GreenMarket.Api.csproj GreenMarket.Api/
RUN dotnet restore GreenMarket.Api/GreenMarket.Api.csproj

COPY src/GreenMarket.Domain/ GreenMarket.Domain/
COPY src/GreenMarket.Infrastructure/ GreenMarket.Infrastructure/
COPY src/GreenMarket.Api/ GreenMarket.Api/

RUN dotnet publish GreenMarket.Api/GreenMarket.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# curl is here for the container healthcheck, nothing else. The aspnet base
# image ships neither curl nor wget, so without it a compose healthcheck has no
# way to probe /health and `depends_on: condition: service_healthy` can never
# be satisfied. ~1MB, and it is not in the build stage, so it never reaches a
# layer that handles source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
    CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1

ENTRYPOINT ["dotnet", "GreenMarket.Api.dll"]
