using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.Enrichers.Span;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace DotNetWebOnFargate.Alpha.Api
{
    public class Program
    {
        public static void Main(string[] args)
        {
            CreateHostBuilder(args).Build().Run();
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .UseSerilog(ConfigureSerilog)
                .ConfigureAppConfiguration(b =>
                {
                    b.AddJsonFile("secrets.json", true);
                })
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                });

        private static void ConfigureSerilog(HostBuilderContext ctx, LoggerConfiguration cfg)
        {
            var appInfo = new {
                AppName = "dotnet-web-on-fargate",
                ComponentName = "alpha",
                Version = Guid.NewGuid()
            };
            
            LogEventLevel logLevel = LogEventLevel.Information;
            var logLevelString = ctx.Configuration.GetValue<string>("Logging:Level");
            if (logLevelString != null && !Enum.TryParse<LogEventLevel>(logLevelString, true, out logLevel))
            {
                throw new Exception($"Invalid configuration: Logging:Level: Value {logLevelString} is not acceptable.");
            }

            cfg
                .MinimumLevel.Is(logLevel)
                .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
                .MinimumLevel.Override("System", LogEventLevel.Information)
                .Enrich.FromLogContext()
                .Enrich.WithSpan()
                .Enrich.WithProperty("AppName", appInfo.AppName)
                .Enrich.WithProperty("ComponentName", appInfo.ComponentName)
                .Enrich.WithProperty("ComponentVersion", appInfo.Version)
                .Enrich.WithProperty("HostingEnvironment", ctx.HostingEnvironment.EnvironmentName.ToLower())
                .WriteTo.Debug()
                ;

            if (ctx.Configuration.GetSection("Logging:Overrides").Exists())
            {
                var loggingOverrides = ctx.Configuration.GetSection("Logging:Overrides").AsEnumerable(true);
                foreach (var o in loggingOverrides)
                {
                    if (!Enum.TryParse<LogEventLevel>(o.Value, true, out logLevel))
                    {
                        throw new Exception(
                            $"Invalid configuration: Logging:Overrides:{o.Key}: Value {o.Value} is not acceptable.");
                    }

                    cfg.MinimumLevel.Override(o.Key, logLevel);
                }
            }

            var consoleOut = ctx.Configuration.GetValue<string>("Logging:Console") ?? "pretty";
            switch (consoleOut)
            {
                case "none":
                    break;
                case "json":
                    cfg.WriteTo.Console(new RenderedCompactJsonFormatter());
                    break;
                case "pretty":
                    cfg.WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3} {SourceContext}]{NewLine}==> {Message:lj}{NewLine}{Exception}");
                    break;
                default:
                    throw new Exception($"Invalid configuration: Logging:Console: Value {consoleOut} is not acceptable.");
            }

            var logFilePath = ctx.Configuration.GetValue<string>("Logging:File:Path");
            if (logFilePath != null)
            {
                var rollingInterval = RollingInterval.Infinite;
                if (ctx.Configuration.GetValue<bool?>("Logging:File:RollingEnabled") == true)
                    rollingInterval = RollingInterval.Day;
                cfg.WriteTo.Async(x => x.File(new RenderedCompactJsonFormatter(), logFilePath, rollingInterval: rollingInterval, retainedFileCountLimit: 5));
            }

        }
    }
}
