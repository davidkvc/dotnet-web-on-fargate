using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Microsoft.AspNetCore.Mvc;

namespace DotNetWebOnFargate.Beta.Api.Controllers
{
    [ApiController]
    public class AppController : ControllerBase
    {
        private static readonly Random rng = new Random();

        [HttpGet("/")]
        public async Task<IActionResult> Get([FromServices] IAmazonDynamoDB dynamo)
        {
            if (rng.Next(100) < 10)
            {
                throw new Exception("random error");
            }

            var queryResult = await dynamo.QueryAsync(new QueryRequest("dotnetwebonfargate")
            {
                KeyConditionExpression = "#r = :v_region",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>()
                {
                    [":v_region"] = new AttributeValue {S = "ke"}
                },
                ExpressionAttributeNames = new Dictionary<string, string>()
                {
                    ["#r"] = "region"
                },
            });

            return Ok(new
            {
                Value = rng.Next(100),
                Items = queryResult.Items
            });
        }
    }
}
