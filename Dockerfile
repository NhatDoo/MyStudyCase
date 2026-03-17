FROM node:22-alpine

# Cài python3 để Worker có thể chạy code Python trực tiếp (không cần Docker socket)
RUN apk add --no-cache python3

WORKDIR /app

# Khởi tạo package và cài thư viện
COPY package*.json ./
RUN npm install

# Copy thư mục Prisma và generate schema 
COPY prisma ./prisma
RUN npx prisma generate

# Copy toàn bộ mã nguồn
COPY . .

# Mặc định expose cổng cho API Server
EXPOSE 3000
