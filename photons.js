function Vector2(x, y) {
	this.x = (x === undefined) ? 0 : x;
	this.y = (y === undefined) ? 0 : y;
}

Vector2.prototype = {
	set: function(x, y) {
		this.x = x || 0;
		this.y = y || 0;
	},

	clone: function() {
		return new Vector2(this.x, this.y)
    },
    
    abs: function() {
        return new Vector2(Math.abs(this.x), Math.abs(this.y));
    },

    max: function(vector) {
        return new Vector2(Math.max(this.x, vector.x), Math.max(this.y, vector.y));
    },

    min: function(vector) {
        return new Vector2(Math.min(this.x, vector.x), Math.min(this.y, vector.y));
    },

	add: function(vector) {
		return new Vector2(this.x + vector.x, this.y + vector.y);
	},

	subtract: function(vector) {
		return new Vector2(this.x - vector.x, this.y - vector.y);
	},

	scale: function(scalar) {
		return new Vector2(this.x * scalar, this.y * scalar);
	},

	dot: function(vector) {
		return (this.x * vector.x + this.y* vector.y);
	},

	magnitude: function() {
		return Math.sqrt(this.magnitudeSqr());
	},

	magnitudeSqr: function() {
		return (this.x * this.x + this.y * this.y);
	},

	distance: function (vector) {
		return Math.sqrt(this.distanceSqr(vector));
	},

	distanceSqr: function (vector) {
		var deltaX = this.x - vector.x;
		var deltaY = this.y - vector.y;
		return (deltaX * deltaX + deltaY * deltaY);
	},

	normalize: function() {
		var mag = this.magnitude();
		var vector = this.clone();
		if(Math.abs(mag) < 1e-9) {
			vector.x = 0;
			vector.y = 0;
		} else {
			vector.x /= mag;
			vector.y /= mag;
		}
		return vector;
	},

	angle: function() {
		return Math.atan2(this.y, this.x);
	},

	rotate: function(alpha) {
		var cos = Math.cos(alpha);
		var sin = Math.sin(alpha);
		var vector = new Vector2();
		vector.x = this.x * cos - this.y * sin;
		vector.y = this.x * sin + this.y * cos;
		return vector;
	},

	toPrecision: function(precision) {
		var vector = this.clone();
		vector.x = vector.x.toFixed(precision);
		vector.y = vector.y.toFixed(precision);
		return vector;
	},

	toString: function () {
		var vector = this.toPrecision(1);
		return ("[" + vector.x + "; " + vector.y + "]");
	}
};

class SDF {
    constructor(width, height) {
        this.data = Array(width * height).fill(Number.MAX_SAFE_INTEGER);
        this.width = width;
        this.height = height;
    }

    add(sdf) {
        this.data = this.data.map((d1, i) => Math.min(d1, sdf(i % width, parseInt(i / width))));
    }

    static Box(offset, size) {
        return (x, y) => {
            let d = new Vector2(x, y).subtract(offset).abs().subtract(size);
            return d.max(new Vector2(0, 0)).magnitude() + Math.min(Math.max(d.x, d.y), 0);
        }
    }
}


class Photons {
    constructor(width, height) {
        const gpu = new GPU();
        this.sdf = new SDF(width, height);

        this.width = width;
        this.height = height;
        
        this.compute = gpu.createKernel(function(sdf, samples, maxSteps, bounces, lx, ly, brightness, gamma) {
            let r = 0;

            if(sdf[this.thread.y * this.constants.width + this.thread.x] < 0) {
                return 0;
            }

            for (let i = 0; i < samples; i++) {    
                // set ray position to [x, y]
                let ro = [this.thread.x, this.thread.y];

                // set ray direction to a ranomized unit vector
                let rn = [Math.random() - 0.5, Math.random() - 0.5];
                let nmag = rn[0] * rn[0] + rn[1] * rn[1];
                let nlen = Math.sqrt(nmag);
                rn[0] /= nmag;
                rn[1] /= nmag;
                
                let light = 1;

                for(let b = 0; b < bounces; b++) {
                    // ray march to objects
                    let t = 0;
                    let hit = [0, 0, 0];
                    for(let j = 0; j < maxSteps; j++) {
                        let p = [ro[0] + rn[0] * t, ro[1] + rn[1] * t];
                        if(p[0] < 0 || p[1] < 0 || p[0] >= this.constants.width || p[1] >= this.constants.height)
                            break;
                        
                        let d = sdf[Math.floor(p[1]) * this.constants.width + Math.floor(p[0])];

                        if(d < 0.001) {
                            hit = [p[0], p[1], 1];
                            break;
                        }

                        t += d;
                    }

                    if(hit[2] < 0.5) { // ray flew off map probably, discard where it hit
                        break;
                    }

                    // ray hit an object, absorb some light
                    light *= 1;

                    // set the bounce ray's position to the hit point
                    ro[0] = hit[0] - rn[0];
                    ro[1] = hit[1] - rn[1];

                    // calculate the normal of the hit surface
                    rn[0] = sdf[Math.floor(ro[1]) * this.constants.width + Math.floor(ro[0] + this.constants.eps)] - sdf[Math.floor(ro[1]) * this.constants.width + Math.floor(ro[0] - this.constants.eps)];
                    rn[1] = sdf[Math.floor(ro[1] + this.constants.eps) * this.constants.width + Math.floor(ro[0])] - sdf[Math.floor(ro[1] - this.constants.eps) * this.constants.width + Math.floor(ro[0])];

                    // normalize ray direction 
                    nmag = rn[0] * rn[0] + rn[1] * rn[1];
                    nlen = Math.sqrt(nmag);
                    rn[0] /= nlen;
                    rn[1] /= nlen;
                }

                // point ray at light
                rn[0] = lx - ro[0];
                rn[1] = ly - ro[1];

                // normalize ray direction 
                nmag = rn[0] * rn[0] + rn[1] * rn[1];
                nlen = Math.sqrt(nmag);
                rn[0] /= nlen;
                rn[1] /= nlen;

                // ray march to light
                let t = 0;
                for(let j = 0; j < maxSteps; j++) {
                    let p = [ro[0] + rn[0] * t, ro[1] + rn[1] * t];
                    if(p[0] < 0 || p[1] < 0 || p[0] >= this.constants.width || p[1] >= this.constants.height)
                        break;
                    
                    let d = sdf[Math.floor(p[1]) * this.constants.width + Math.floor(p[0])];

                    if(t + d >= nlen) // light is visible, stop ray marching
                        break;
                    if(d < 0.001) { // light is obstructed
                        light = 0;
                        break;
                    }

                    t += d;
                }

                // add w/ inv square law
                r += light / nmag * brightness;
            }

            r /= samples;
            
            return Math.pow(r, gamma);
        }, {
            constants: { width, height, eps: 1 },
            output: [width, height]
        });
    }

    test(sdf, samples, maxSteps, bounces, lx, ly, els) {
        let points = [];

        let r = 0;

        this.thread = { x: lx, y: ly };
        this.constants = { width: this.width, height: this.height, eps: 1 };

        let el = document.createElement('p');

        for (let i = 0; i < 1; i++) {    
            // set ray position to [x, y]
            let ro = [this.thread.x, this.thread.y];

            // set ray direction to a ranomized unit vector
            let rn = [Math.random() - 0.5, Math.random() - 0.5];
            let nmag = rn[0] * rn[0] + rn[1] * rn[1];
            let nlen = Math.sqrt(nmag);
            rn[0] /= nmag;
            rn[1] /= nmag;
            
            let light = 1;

            for(let b = 0; b < bounces; b++) {
                // ray march to objects
                let t = 0;
                let hit = [0, 0, 0];
                for(let j = 0; j < maxSteps; j++) {
                    let p = [ro[0] + rn[0] * t, ro[1] + rn[1] * t];
                    if(p[0] < 0 || p[1] < 0 || p[0] >= this.constants.width || p[1] >= this.constants.height)
                        break;
                    
                    let d = sdf[Math.floor(p[1]) * this.constants.width + Math.floor(p[0])];
                    points.push([p[0], p[1], d]);
                    
                    if(d < 0.001) {
                        hit = [p[0], p[1], 1];
                        points.push([p[0], p[1], 'HIT']);
                        break;
                    }

                    t += d;
                }

                if(hit[2] < 0.5) { // ray flew off map probably, discard where it hit
                    break;
                }

                // ray hit an object, absorb some light
                light *= 1;

                // set the bounce ray's position to the hit point
                ro[0] = hit[0] - rn[0];
                ro[1] = hit[1] - rn[1];

                // calculate the normal of the hit surface
                rn[0] = sdf[Math.floor(ro[1]) * this.constants.width + Math.floor(ro[0] + this.constants.eps)] - sdf[Math.floor(ro[1]) * this.constants.width + Math.floor(ro[0] - this.constants.eps)];
                rn[1] = sdf[Math.floor(ro[1] + this.constants.eps) * this.constants.width + Math.floor(ro[0])] - sdf[Math.floor(ro[1] - this.constants.eps) * this.constants.width + Math.floor(ro[0])];

                // normalize ray direction 
                nmag = rn[0] * rn[0] + rn[1] * rn[1];
                nlen = Math.sqrt(nmag);
                rn[0] /= nlen;
                rn[1] /= nlen;
            }

            // point ray at light
            rn[0] = lx - ro[0];
            rn[1] = ly - ro[1];

            // normalize ray direction 
            nmag = rn[0] * rn[0] + rn[1] * rn[1];
            nlen = Math.sqrt(nmag);
            rn[0] /= nlen;
            rn[1] /= nlen;

            // ray march to light
            let t = 0;
            for(let j = 0; j < maxSteps; j++) {
                let p = [ro[0] + rn[0] * t, ro[1] + rn[1] * t];
                if(p[0] < 0 || p[1] < 0 || p[0] >= this.constants.width || p[1] >= this.constants.height)
                    break;
                
                let d = sdf[Math.floor(p[1]) * this.constants.width + Math.floor(p[0])];
                points.push([p[0], p[1], d]);

                if(t + d >= nlen) // light is visible, stop ray marching
                    break;
                if(d < 0.001) { // light is obstructed
                    light = 0;
                    break;
                }

                t += d;
            }
        }

        return points;
    }

    trace(lx, ly, brightness, gamma, samples = 10, maxSteps = 32, bounces = 1) {
        return this.compute(this.sdf.data, samples, maxSteps, bounces, lx, ly, brightness, gamma);
    }
}