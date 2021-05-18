using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DotNetWebOnFargate.Api.Controllers
{
    [ApiController]
    public class AppController : ControllerBase
    {
        [HttpGet("/")]
        public IActionResult Get()
        {
            return Ok(new {hello="world"});
        }

        [HttpGet("/whatever")]
        public IActionResult GetWhatever()
        {
            return Ok(new {message="whatever"});
        }

        [HttpGet("/break")]
        public IActionResult Break([FromServices] Breaker breaker)
        {
            breaker.Break();
            return Ok(new {message="broken"});
        }

        [HttpGet("/status")]
        public IActionResult GetStatus([FromServices] Breaker breaker)
        {
            return Ok(new {isBroken = breaker.IsBroken});
        }

        [HttpGet("/secrets")]
        public IActionResult GetSecrets([FromServices] IConfiguration conf)
        {
            return Ok(new {password = conf.GetValue<string>("password")});
        }

        //https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4.html
        [HttpGet("/metadata/{**path}")]
        public async Task GetMetadata(string path)
        {
            using var client = new HttpClient();
            using var response = await client.GetAsync($"{Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4")}/{path}");

            HttpContext.Response.StatusCode = 200;
            HttpContext.Response.ContentType = "application/json";
            await response.Content.CopyToAsync(HttpContext.Response.Body);
        }
    }
}
