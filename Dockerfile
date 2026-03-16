FROM node:18-alpine

# Cài đặt docker-cli để Worker có thể spawn lệnh docker run
RUN apk add --no-cache docker-cli

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
