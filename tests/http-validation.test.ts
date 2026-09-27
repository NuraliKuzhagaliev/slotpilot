import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/server/app/http.ts';
import { parseToolArguments } from '../src/contracts/tools.ts';
import { ErrorResponseSchema } from '../src/contracts/app.ts';

test('invalid voice tool argument identifies the field without echoing its value',async()=>{
  const response=await handle(async()=>{
    parseToolArguments('update_request',{patch:{arrivalNotBefore:'afternoon'},expectedRequestVersion:2});
    return Response.json({ok:true});
  });
  assert.equal(response.status,400);
  const body=ErrorResponseSchema.parse(await response.json());
  assert.equal(body.error.code,'VALIDATION_ERROR');
  assert.match(body.error.message,/\$\.patch\.arrivalNotBefore/);
  assert.doesNotMatch(body.error.message,/afternoon/);
});

test('malformed request envelope identifies a missing tool field',async()=>{
  const { z }=await import('zod');
  const response=await handle(async()=>{
    z.object({callId:z.string()}).parse({});
    return Response.json({ok:true});
  });
  assert.equal(response.status,400);
  assert.match(ErrorResponseSchema.parse(await response.json()).error.message,/\$\.callId/);
});
