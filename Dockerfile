FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 make g++
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY index*.js ./
EXPOSE 10000
CMD ["npm", "start"]
