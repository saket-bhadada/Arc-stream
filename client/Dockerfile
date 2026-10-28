# Stage 1: Build React + Vite client
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .

ARG VITE_NODE_BASE=http://127.0.0.1:3000
ENV VITE_NODE_BASE=$VITE_NODE_BASE

RUN npm run build

# Stage 2: Serve static bundle with Nginx
FROM nginx:1.27-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
