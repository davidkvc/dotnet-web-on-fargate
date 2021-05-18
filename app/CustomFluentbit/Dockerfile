FROM public.ecr.aws/aws-observability/aws-for-fluent-bit:stable

COPY fluentbit.conf /fluent-bit/etc/fluent-bit.conf
COPY parsers.conf /fluent-bit/etc/parsers.conf
RUN mkdir /logs

CMD [ "/fluent-bit/bin/fluent-bit", "-e", "/fluent-bit/firehose.so", "-e", "/fluent-bit/cloudwatch.so", "-e", "/fluent-bit/kinesis.so", "-c", "/fluent-bit/etc/fluent-bit.conf", "-R", "/fluent-bit/etc/parsers.conf"]