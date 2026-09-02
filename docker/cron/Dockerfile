FROM alpine:3.20
RUN apk add --no-cache curl
COPY docker/cron/cron-dispatch.sh /usr/local/bin/cron-dispatch.sh
RUN chmod +x /usr/local/bin/cron-dispatch.sh
COPY docker/cron/crontab /etc/crontabs/root
ENTRYPOINT ["/usr/sbin/crond", "-f", "-l", "2"]
