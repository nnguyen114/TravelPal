# Render: the web app and core-api in one service, so the app and its API share one address (cookies, live updates).
# Build context is the repo root:  docker build -f deploy/render/app.Dockerfile -t travelpal-app .
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM eclipse-temurin:21-jdk AS api
WORKDIR /src
COPY core-api/.mvn .mvn
COPY core-api/mvnw core-api/pom.xml ./
RUN ./mvnw -q dependency:go-offline
COPY core-api/src src
COPY --from=web /web/dist src/main/resources/static
RUN ./mvnw -q package -DskipTests && cp target/core-api-*.jar app.jar

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
USER 10001
COPY --from=api /src/app.jar /app/app.jar
EXPOSE 10000
# Sized for small instances (Render's 512 MB plans).
# C1 only (TieredStopAtLevel=1) starts much faster on a fraction of a CPU and uses less memory.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xss512k", "-jar", "/app/app.jar"]
