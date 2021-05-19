# https://hub.docker.com/_/microsoft-dotnet
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build

WORKDIR /source

COPY DotNetWebOnFargate.Client.Api.csproj .

RUN dotnet restore 

# copy everything else and build app
COPY . .
RUN dotnet publish -c debug -o /app --no-restore

# final stage/image
FROM mcr.microsoft.com/dotnet/aspnet:5.0

RUN apt-get update && apt-get install -y curl jq unzip uuid-runtime

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install

WORKDIR /app

COPY run_in_docker.sh .
RUN chmod +x run_in_docker.sh

COPY --from=build /app ./

ENV ASPNETCORE_ENVIRONMENT=development
ENV ASPNETCORE_URLS=http://+:5000;http://+:81
ENV HealthCheckPort=81

HEALTHCHECK CMD /bin/bash -c '[[ "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:81/_health)" == "200" ]] && exit 0 || exit 1'

CMD /app/run_in_docker.sh