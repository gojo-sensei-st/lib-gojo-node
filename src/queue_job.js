// vim: ts=4:sw=4:expandtab

/*
 * jobQueue manages multiple queues indexed by device to serialize
 * session io ops on the database.
 * 
 * FIXED: recursive execute() was called without await causing race condition
 * that corrupted Signal session state and produced bad MAC errors.
 */
'use strict';

const _queueAsyncBuckets = new Map();
const _gcLimit = 10000;

async function _asyncQueueExecutor(queue, cleanup) {
    let offt = 0;

    async function execute() {
        let limit = Math.min(queue.length, _gcLimit);
        for (let i = offt; i < limit; i++) {
            const job = queue[i];
            try {
                job.resolve(await job.awaitable());
            } catch (e) {
                job.reject(e);
            }
        }
        if (limit < queue.length) {
            if (limit >= _gcLimit) {
                queue.splice(0, limit);
                offt = 0;
            } else {
                offt = limit;
            }
            // ✅ FIX: await الركورس — يمنع التوازي في تنفيذ jobs التشفير
            // بدون await كانت عمليات Signal تتشغل بالتوازي = bad MAC
            await execute();
        } else {
            return cleanup();
        }
    }

    await execute();
}

module.exports = function (bucket, awaitable) {
    if (!awaitable.name) {
        Object.defineProperty(awaitable, 'name', { writable: true });
        if (typeof bucket === 'string') {
            awaitable.name = bucket;
        }
    }
    let inactive;
    if (!_queueAsyncBuckets.has(bucket)) {
        _queueAsyncBuckets.set(bucket, []);
        inactive = true;
    }
    const queue = _queueAsyncBuckets.get(bucket);
    const job = new Promise((resolve, reject) => queue.push({
        awaitable,
        resolve,
        reject
    }));
    if (inactive) {
        _asyncQueueExecutor(queue, () => _queueAsyncBuckets.delete(bucket));
    }
    return job;
};
