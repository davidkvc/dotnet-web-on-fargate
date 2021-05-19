#!/bin/bash

cat <<EOF > /fluent-bit/etc/fluent-bit.conf
[INPUT]
    Name    tail
    Path    /logs/*.log
    Parser  json
    DB      /logs/tail.db

[OUTPUT]
    Name                cloudwatch
    Match               **
    region              $REGION
    log_group_name      $LOG_GROUP_NAME
    log_stream_name     app-\$(ecs_task_id)
    auto_create_group   false
EOF

/fluent-bit/bin/fluent-bit -e /fluent-bit/firehose.so -e /fluent-bit/cloudwatch.so -e /fluent-bit/kinesis.so -c /fluent-bit/etc/fluent-bit.conf -R /fluent-bit/etc/parsers.conf