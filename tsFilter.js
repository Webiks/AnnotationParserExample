const { Transform } = require('stream'); 

const syncByte = 0x47;

function createTransform(packetId) {
    const transform = new Transform( { objectMode: true } );
    
    transform._transform = function(chunk, encoding, done) {
        if (chunk[0] !== syncByte || chunk.length < 3) {
            done();
            return;
        }
        const chunkPacketId = ((chunk[1] & 0x1F) << 8) | chunk[2];
        if (chunkPacketId === packetId) {
            this.push(chunk);
        }
        done();
    };
    
    transform._flush = function(done) {
        done();
    };
    return transform;
}

module.exports = createTransform;
