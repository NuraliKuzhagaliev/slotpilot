import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptPatch,unsavedTranscriptPatch } from '../src/features/voice/transcript-patch.mjs';

const now=new Date('2026-09-28T19:37:30Z');
test('final spoken details from the supplied recording become explicit request fields',()=>{
 assert.deepEqual(transcriptPatch('Hello, I need an oil change for my petrol crossover.',now),{addServiceIds:['oil-change'],vehicleId:'crossover-petrol'});
 assert.deepEqual(transcriptPatch('15th of October.',now),{allowedDates:['2026-10-15']});
 assert.deepEqual(transcriptPatch('October 20th, in the afternoon.',now),{allowedDates:['2026-10-20'],arrivalNotBefore:'12:00',arrivalNotAfter:'17:00'});
 assert.deepEqual(transcriptPatch('North branch.',now),{allowedBranchIds:['north'],preferredBranchId:'north'});
});
test('spoken arrival times and safe deadlines map to the correct fields',()=>{
 assert.deepEqual(transcriptPatch('I can bring it in at 3 pm.',now),{arrivalNotBefore:'15:00',arrivalNotAfter:'15:00'});
 assert.deepEqual(transcriptPatch('I need it ready by 4 pm.',now),{readyNoLaterThan:'16:00'});
 assert.deepEqual(transcriptPatch('After lunch.',now),{arrivalNotBefore:'13:00',arrivalNotAfter:'17:00'});
});
test('uncertain, negated, impossible and out-of-horizon dates do not change the visit',()=>{
 assert.equal(transcriptPatch('Maybe October 15th.',now),null);
 assert.equal(transcriptPatch("I don't need an oil change.",now),null);
 assert.equal(transcriptPatch('February 30th.',now),null);
 assert.equal(transcriptPatch('December 15th.',now),null);
 assert.equal(transcriptPatch('Yes, book it.',now),null);
 assert.equal(transcriptPatch('Hello?',now),null);
});
test('already saved fields are omitted so a model update and transcript safety net do not duplicate a write',()=>{
 const patch=transcriptPatch('Oil change on October 15th, afternoon.',now);
 assert.deepEqual(unsavedTranscriptPatch(patch,{serviceIds:['oil-change'],allowedDates:['2026-10-15'],arrivalNotBefore:'12:00',arrivalNotAfter:'17:00'}),null);
 assert.deepEqual(unsavedTranscriptPatch(patch,{serviceIds:['oil-change'],allowedDates:null,arrivalNotBefore:null,arrivalNotAfter:null}),{allowedDates:['2026-10-15'],arrivalNotBefore:'12:00',arrivalNotAfter:'17:00'});
});

test('the fallback cannot re-add removed services or narrow an approximate arrival to one exact slot',()=>{
 for(const phrase of ['Remove computer diagnostics.','Brake inspection without an oil change.','No diagnostics.','Tire service rather than diagnostics.','Drop the oil change.','I can arrive before 3 pm.','I will come after 3 pm.','Around 4 pm.','Ready after 4 pm.'])assert.equal(transcriptPatch(phrase,now),null,phrase);
 assert.deepEqual(transcriptPatch('Drop off at 3 pm.',now),{arrivalNotBefore:'15:00',arrivalNotAfter:'15:00'});
});
