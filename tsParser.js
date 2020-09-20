const { Transform } = require('stream'); 

const syncByte = 0x47;

function zero_fill_right_shift(val, n) {
    if (val >= 0) {
        return (val >> n);
    }
    return ((val + 0x100000000) >> n);
}

function read_unsigned_int32_be(data, index) {
    return data.readUInt32BE(index);
}

function read_unsigned_int_be(data, index, len) {
    return data.readUIntBE(index, len);
}

function extract_adaptation_optional_fields(data, field) {
    index = 6
    optional_fields = {}

    if (field['pcr_flag']) {
        optional_fields['pcr_base'] = read_unsigned_int32_be(data, index) * 2 + 
                                      zero_fill_right_shift(data[index + 4] & 0x80, 7);
        optional_fields['pcr_extension'] = (data[index + 4] & 0x1 << 8) + data[index + 5];
        index += 6;
    }

    if (field['opcr_flag']) {
        optional_fields['opcr_base'] = read_unsigned_int32_be(data, index) * 2 + 
                                       zero_fill_right_shift(data[index + 4] & 0x80, 7);
        optional_fields['opcr_extension'] = (data[index + 4] & 0x1 << 8) + data[index + 5];
        index += 6;
    }

    if (field['splicing_point_flag']) {
        optional_fields['splice_countdown'] = data[index];
        index += 1;
    }

    if (field['transport_private_data_flag']) {
        optional_fields['transport_private_data_length'] = data[index];
        optional_fields['private_data'] = null  // TODO
        index += 1 + field['transport_private_data_flag'];
    }

    // TODO extract other fields
    return optional_fields
}

function extract_adaptation_field(data) {
    length = data[4]

    if (length <= 0) {
        return {'field_length': length};
    }

    field = {
        'field_length': length,
        'discontinuity_indicator': zero_fill_right_shift(data[5] & 0x80, 7),
        'random_access_indicator': zero_fill_right_shift(data[5] & 0x40, 6),
        'elementary_stream_priority_indicator': zero_fill_right_shift(data[5] & 0x20, 5),
        'pcr_flag': zero_fill_right_shift(data[5] & 0x10, 4),
        'opcr_flag': zero_fill_right_shift(data[5] & 0x08, 3),
        'splicing_point_flag': zero_fill_right_shift(data[5] & 0x04, 2),
        'transport_private_data_flag': zero_fill_right_shift(data[5] & 0x02, 1),
        'adaptation_field_extension_flag': data[5] & 0x01
    }
    field['optional_fields'] = extract_adaptation_optional_fields(data, field)
    return field
}

function get_timestamp(data, index) {
    timestamp = (read_unsigned_int_be(data, index, 1) & 0x0E) * 536870912;
    timestamp += (read_unsigned_int_be(data, index + 1, 2) & 0xFFFE) * 16384;
    timestamp += Math.round(read_unsigned_int_be(data, index + 3, 2) / 2);
    return timestamp;
}

function extract_pes(data) {
    if (data.length < 3) {
        return null;
    }
    if (read_unsigned_int_be(data, 0, 3) != 1) {
        return null;
    }
    optional_header = read_unsigned_int_be(data, 6, 2);
    pes = {
        'packet_start_code_prefix': read_unsigned_int_be(data, 0, 3),
        'stream_id': read_unsigned_int_be(data, 3, 1),
        'packet_length': read_unsigned_int_be(data, 4, 2),
        'scrambling_control': zero_fill_right_shift(optional_header & 0x3000, 12),
        'priority': (optional_header & 0x800) != 0,
        'data_alignment_indicator': (optional_header & 0x400) != 0,
        'copyright': (optional_header & 0x200) != 0,
        'original_or_copy': (optional_header & 0x100) != 0,
        'pts_dts_flags': (optional_header & 0xc0) >> 6,
        'escr_flag': (optional_header & 0x20) != 0,
        'sr_rate_flag': (optional_header & 0x10) != 0,
        'dsm_trick_mode_flag': (optional_header & 0x08) != 0,
        'additional_copy_info_flag': (optional_header & 0x04) != 0,
        'crc_flag': (optional_header & 0x02) != 0,
        'extension_flag': (optional_header & 0x01) != 0,
        'header_data_length': read_unsigned_int_be(data, 8, 1),
        'data_index': optional_header ? 9 : 6
    }

    if (pes['pts_dts_flags'] & 0x2) {
        pes['pts'] = get_timestamp(data, 9);
        pes['data_index'] = 14;
    }

    if (pes['pts_dts_flags'] & 0x1) {
        pes['dts'] = get_timestamp(data, 14);
        pes['data_index'] = 19;
    }

    pes['data_size'] = data.length - pes['data_index'];

    return pes
}

function createTransform() {
    const transform = new Transform( { objectMode: true } );
    
    transform._transform = function(chunk, encoding, done) {
        if (chunk[0] !== syncByte) {
            done();
            return;
        }
        const packet = {
            'sync_byte': chunk[0],
            'transport_error_indicator': zero_fill_right_shift(chunk[1] & 0x80, 7),
            'payload_unit_start_indicator': zero_fill_right_shift(chunk[1] & 0x40, 6),
            'transport_priority': zero_fill_right_shift(chunk[1] & 0x20, 5),
            'packet_id': ((chunk[1] & 0x1F) << 8) | chunk[2],
            'transport_scrambling_control': zero_fill_right_shift(chunk[3] & 0xC0, 6),
            'adaptation_field_control': zero_fill_right_shift(chunk[3] & 0x30, 4),
            'continuity_counter': chunk[3] & 0x0F,
            'payload_index': 4
        }
    
        const field_control = packet['adaptation_field_control']
        if ((field_control == 0x02) || (field_control == 0x03)) { 
            packet['adaptation_field'] = extract_adaptation_field(chunk);
        }
    
        if (field_control == 0x01) {
            packet['payload_index'] = 4;
        } else if (field_control == 0x03) {
            packet['payload_index'] = 5 + packet['adaptation_field']['field_length'];
        }
    
        if (packet['payload_index'] > chunk.length) {
            console.log(packet['packet_id'], `Packet has payload start bigger then length: ${packet["payload_index"]} >= ${chunk.length}`)
            done();
            return;
        }
    
        packet['payload'] = chunk.slice(packet['payload_index'])
        packet['pes'] = extract_pes(packet['payload'])
        if (packet['pes']) {
            packet['payload'] = packet['payload'].slice(packet['pes']['data_index']);
        }
        this.push(packet);
        done();
    };
    
    transform._flush = function(done) {
        done();
    };
    return transform;
}

module.exports = createTransform;
