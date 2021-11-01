using System;
using Amazon.DynamoDBv2;
using Amazon.Extensions.NETCore.Setup;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.OpenApi.Models;
using OpenTelemetry;
using OpenTelemetry.Contrib.Extensions.AWSXRay.Trace;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace DotNetWebOnFargate.Beta.Api
{
    public class Startup
    {
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddControllers();
            services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new OpenApiInfo { Title = "DotNetWebOnFargate.Beta.Api", Version = "v1" });
            });

            services.AddSingleton<Breaker>();
            services.AddTransient<IsBrokenCheck>();

            services.AddHealthChecks()
                .AddCheck<IsBrokenCheck>("default");

            services.AddOpenTelemetryTracing(b =>
            {
                b
                    .AddXRayTraceId()
                    .AddAWSInstrumentation()
                    .AddAspNetCoreInstrumentation(o =>
                    {
                        o.Filter = ctx => ctx.Request.Path != "/_health";
                    })
                    .AddHttpClientInstrumentation()
                    .AddSqlClientInstrumentation(o => o.SetDbStatementForText = true)
                    .SetResourceBuilder(ResourceBuilder.CreateDefault()
                        .AddService("beta", serviceNamespace: "dotnet-web-on-fargate"));

                Sdk.SetDefaultTextMapPropagator(new AWSXRayPropagator());

                b.AddSource("app");

                b.AddOtlpExporter(o =>
                {
                    o.ExportProcessorType = ExportProcessorType.Simple;
                    o.Endpoint = new Uri("http://localhost:4317");
                });
            });

            services.AddDefaultAWSOptions(Configuration.GetAWSOptions());
            services.AddAWSService<IAmazonDynamoDB>();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
                app.UseSwagger();
                app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "DotNetWebOnFargate.Alpha.Api v1"));
            }

            app.UseRouting();

            var healthCheckPort = Configuration.GetValue<int?>("HealthCheckPort");
            if (healthCheckPort != null)
            {
                app.UseHealthChecks("/_health", healthCheckPort.Value,
                    new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
                    {
                        AllowCachingResponses = false
                    });
            }

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
            });
        }
    }
}
