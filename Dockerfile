# Build stage
FROM node:20-alpine AS build
WORKDIR /workspace
COPY clients/angular-auth ./clients/angular-auth
WORKDIR /workspace/file-management/notes
COPY file-management/notes/package.json ./package.json
COPY file-management/notes/yarn.lock ./yarn.lock
RUN corepack enable \
 && if [ -f yarn.lock ]; then yarn install --immutable; else yarn install; fi \
 && ln -s /workspace/file-management/notes/node_modules /workspace/node_modules
COPY file-management/notes/ .
RUN yarn build

# Runtime stage
FROM nginx:1.27-alpine
# Angular 17+ application builder outputs browser assets under dist/<app>/browser
COPY --from=build /workspace/file-management/notes/dist/notes/browser /usr/share/nginx/html
COPY file-management/notes/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
