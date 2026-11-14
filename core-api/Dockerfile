# Build: docker build -t core-api core-api
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -q dependency:go-offline
COPY src src
RUN ./mvnw -q package -DskipTests && cp target/core-api-*.jar app.jar

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
USER 10001
COPY --from=build /src/app.jar /app/app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
