# Use an official Node.js image as the base image
FROM node:20.17.0 AS node-builder

# Set working directory
WORKDIR /.

# Copy the package.json and package-lock.json files
COPY package*.json ./

COPY ./requirements.txt ./

COPY . .
RUN ls -la /app

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# Use an official Python image as the base image
FROM python:3.12.6 AS python-builder

# Copy the rest of the app
COPY --from=node-builder . .
RUN ls -la /app

RUN apt-get update && apt-get install -y poppler-utils

# # Build the Next.js app
RUN pnpm build

# Expose the ports that the project runs on
ENV PORT 3000
EXPOSE 3000 8000

# Start the Next.js app
CMD ["pnpm", "dev"]