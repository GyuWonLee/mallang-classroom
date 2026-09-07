# Jenkins가 gradlew build로 만든 jar를 이미지로 패키징
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY build/libs/*-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
