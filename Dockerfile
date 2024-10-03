# Use an official Python image as the base image
FROM python:3.12.6 AS python-builder
# Set working directory
WORKDIR /.

RUN python3 -m venv env
RUN bash -c "source env/bin/activate"

RUN apt-get update && apt-get install -y poppler-utils

# Copy the requirements file and install Python dependencies
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy the rest of the application code (including Python files)
COPY . .

# Copy the rest of the app
RUN ls -la /app

# Use an official Node.js image as the base image
FROM node:20.17.0 AS node-builder

# WORKDIR /.

COPY --from=python-builder . .
RUN ls -la /app

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# # Build the Next.js app
RUN pnpm build

# Expose the ports that the project runs on
# ENV PORT 3000
EXPOSE 3000 8000

# Start the Next.js app
CMD ["pnpm", "start"]