const { Transform } = require('stream'); 
const zlib = require('zlib');

function createTransform(isIncludeEmptyData) {
    const transform = new Transform( { objectMode: true } );
    
    transform._transform = function(chunk, encoding, done) {
        const packet = chunk;
        if (packet['payload_unit_start_indicator']) {
            this._length = packet['payload'].readUInt32BE(0);
            this._buffer = packet['payload'].slice(4);
        } else {
            this._buffer = this._buffer ? Buffer.concat([this._buffer, packet['payload']]) : packet['payload'];
        }
        if (this._length > 0 && this._length == this._buffer.length) {
            const buffer = this._buffer;
            this._length = null;
            this._buffer = null;
            zlib.inflateRaw(buffer, (error, result) => {
                if (error) {
                    console.error(error);
                    done();
                    return;
                }
                try {
                    const dataString = result.toString('utf-8');
                    const data = JSON.parse(dataString);
                    this.push(data);
                } catch {
                    console.error("Failed to parse data");
                }
                done();
            });
        } else if (isIncludeEmptyData && packet['payload_unit_start_indicator'] && this._length === 0) {
            this.push({});
            done();
        } else {
            done();
        }
    };
    
    transform._flush = function(done) {
        done();
    };
    return transform;
}

module.exports = createTransform;
