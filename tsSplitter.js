const { Transform } = require('stream'); 

const packetSize = 188;
const syncByte = 0x47;

function createTransform() {
    const transform = new Transform( { objectMode: true } );
    
    transform._transform = function(chunk, encoding, done) {
        let i = 0;
        if (this.packetStart) {
            chunk = Buffer.concat([this.packetStart, chunk]);
            this.packetStart = null;
        }
        const len = chunk.length;
        while (i < len) {
            if (chunk[i] !== syncByte) {
                let j = i;
                while (chunk[j] !== syncByte) {
                    j = chunk.indexOf(syncByte, j + 1);
                    if (j === -1) {
                        break;
                    }
                }
                if (j === -1) {
                    break;
                }
                i = j;   
            }
            if (i + packetSize > len) {
                this.packetStart = chunk.slice(i, len);
                break;
            } else {
                this.push(chunk.slice(i, i + packetSize))
                i += packetSize;
            }
        }
        done();
    };
    
    transform._flush = function(done) {
        done();
    };
    return transform;
}

module.exports = createTransform;
