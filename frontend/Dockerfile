FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY . /var/www/react-app

RUN npm install && npm run build

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

