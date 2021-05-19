FROM public.ecr.aws/aws-observability/aws-for-fluent-bit:stable

COPY fluentbit.conf /fluent-bit/etc/fluent-bit.conf
COPY parsers.conf /fluent-bit/etc/parsers.conf
RUN mkdir /logs

COPY entrypoint.sh .
RUN chmod u+x entrypoint.sh

CMD ./entrypoint.sh