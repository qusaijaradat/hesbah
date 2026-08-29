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
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "GreenMarket.Api.dll"]
