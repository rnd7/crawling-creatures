'use strict';

// Imports
const electron = require('electron')
const {ipcRenderer, remote} = electron
const path = require("path")
const fs = require("fs")
var Stats = require('stats-js')
var THREE = require('three')

const WarpShader = {
	uniforms: {
    "showMasked" :  { type: "i", value: 1 },
    "aspect" :  { type: "f", value: 1 },
    "mask": { type:'t', value: null },
    "diffuse": { type:'t', value: null },
	},
	vertexShader: [
    "attribute vec3 warp;",
    "uniform float aspect;",
    "varying vec2 vUv;",
    "varying vec3 vWarp;",
    "void main() {",
			"vUv = uv;",
      "vWarp = warp;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
		"}"
	].join( "\n" ),
	fragmentShader: [
    "uniform int showMasked;",
    "uniform float aspect;",
    "uniform sampler2D mask;",
    "uniform sampler2D diffuse;",
    "varying vec2 vUv;",
    "varying vec3 vWarp;",
    "void main() {",
      "vec2 uvq = vec2(vWarp.x/vWarp.z, 1.-(vWarp.y/vWarp.z));",
      "vec4 diffuseCol = texture2D(diffuse, uvq);",
      //"gl_FragColor = diffuseCol;",
      "vec4 maskCol = texture2D(mask, uvq);",
      "if (showMasked == 1) {",
        "maskCol.r = clamp(maskCol.r, .5, 1.);",
        "diffuseCol.g = 1.;",
      "}",
      "gl_FragColor = vec4(diffuseCol.rgb*maskCol.r, diffuseCol.a*maskCol.r);",
    "}",
	].join( "\n" )
}




function makePositionBuffer(position, bottomLeft, bottomRight, topRight, topLeft) {

		var bufferIndex = 0
    position[bufferIndex++] = bottomLeft.x
    position[bufferIndex++] = bottomLeft.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = bottomRight.x
    position[bufferIndex++] = bottomRight.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = topRight.x
    position[bufferIndex++] = topRight.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = topLeft.x
    position[bufferIndex++] = topLeft.y
    position[bufferIndex++] = 0

    return position
}

function makeUVBuffer(uvs, bottomLeft, bottomRight, topRight, topLeft) {

		var bufferIndex = 0
    uvs[bufferIndex++] = bottomLeft.x
    uvs[bufferIndex++] = bottomLeft.y
    uvs[bufferIndex++] = bottomRight.x
    uvs[bufferIndex++] = bottomRight.y
    uvs[bufferIndex++] = topRight.x
    uvs[bufferIndex++] = topRight.y
    uvs[bufferIndex++] = topLeft.x
    uvs[bufferIndex++] = topLeft.y

    return uvs
}

function makeWarpBuffer(warp, bottomLeft, bottomRight, topRight, topLeft) {
		var ax = topRight.x - bottomLeft.x;
		var ay = topRight.y - bottomLeft.y;
		var bx = topLeft.x - bottomRight.x;
		var by = topLeft.y - bottomRight.y;
  	var cross = ax * by - ay * bx;

		if (cross != 0) {
			var cy = bottomLeft.y - bottomRight.y;
			var cx = bottomLeft.x - bottomRight.x;

			var s = (ax * cy - ay * cx) / cross;

			if (s > 0 && s < 1) {
				var t = (bx * cy - by * cx) / cross;

				if (t > 0 && t < 1) {
					//uv coordinates for texture
					var u0 = 0 // texture bottom left u
					var v0 = 0 // texture bottom left v
					var u2 = 1 // texture top right u
					var v2 = 1 // texture top right v

					var bufferIndex = 0;

					var q0 = 1 / (1 - t)
					var q1 = 1 / (1 - s)
					var q2 = 1 / t
					var q3 = 1 / s

          // bl
					warp[bufferIndex++] = u0 * q0
					warp[bufferIndex++] = v2 * q0
					warp[bufferIndex++] = q0

					warp[bufferIndex++] = u2 * q1;
					warp[bufferIndex++] = v2 * q1;
					warp[bufferIndex++] = q1;

					warp[bufferIndex++] = u2 * q2;
					warp[bufferIndex++] = v0 * q2;
					warp[bufferIndex++] = q2;

					warp[bufferIndex++] = u0 * q3;
					warp[bufferIndex++] = v0 * q3;
					warp[bufferIndex++] = q3;

				}
			}
		}
    return warp
}

function makeNormalBuffer(normal, bottomLeft, bottomRight, topRight) {

    const MULT = 32767 // MAX INT

    var pA = new THREE.Vector3(bottomLeft.x, bottomLeft.y, 0.)
    var pB = new THREE.Vector3(bottomRight.x, bottomRight.y, 0.)
    var pC = new THREE.Vector3(topRight.x, topRight.y, 0.)

    var cb = new THREE.Vector3()
    var ab = new THREE.Vector3()

    // tri 1 is enough
		cb.subVectors(pC, pB)
		ab.subVectors(pA, pB)
		cb.cross(ab)
		cb.normalize()

    cb.multiplyScalar(MULT)

    var bufferIndex = 0
    for (bufferIndex; bufferIndex<normal.length; bufferIndex+=3) {
  		normal[bufferIndex] = cb.x;
  		normal[bufferIndex+1] = cb.y;
  		normal[bufferIndex+2] = cb.z;
    }
    return normal
}

function makeQuad() {
  var t = {}
  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 3)
  t.camera.updateProjectionMatrix()
  t.camera.position.z = 2

  t.geometry = new THREE.BufferGeometry()

  t.bl = new THREE.Vector2(0, 0)
  t.br = new THREE.Vector2(1, 0)
  t.tr = new THREE.Vector2(1, 1)
  t.tl = new THREE.Vector2(0, 1)

  var position = new Float32Array(4*3)
  var warp = new Float32Array(4*3);
  var normal = new Float32Array(4*3)
  var uv = new Float32Array(4*2)

  makePositionBuffer(position, t.bl, t.br, t.tr, t.tl)
  makeWarpBuffer(warp, t.bl, t.br, t.tr, t.tl)
  makeNormalBuffer(normal, t.bl, t.br, t.tr) // from first tri only
  makeUVBuffer(
    uv,
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1)
  )
  var index = new Uint32Array([
    0, 1, 2, 2, 3, 0
  ])

	t.geometry.setIndex( new THREE.BufferAttribute(index, 1) );
  t.geometry.addAttribute('position', new THREE.BufferAttribute(position, 3));
  t.geometry.addAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  t.geometry.addAttribute('warp', new THREE.BufferAttribute(warp, 3));
	t.geometry.addAttribute('normal', new THREE.BufferAttribute( normal, 3, true ) );

  t.material = new THREE.ShaderMaterial(WarpShader)
  t.mesh = new THREE.Mesh(t.geometry, t.material)
  t.mesh.position.z = 0

  t.scene.add(t.mesh)

  t.setSize = function(width, height) {
    t.width = width || 512
    t.height = height || 512
    t.camera.updateProjectionMatrix()
    t.updatePoints()
  }

  t.updatePoints = function() {
    makePositionBuffer(position, t.bl, t.br, t.tr, t.tl)
    makeWarpBuffer(warp, t.bl, t.br, t.tr, t.tl)
    t.geometry.attributes.position.needsUpdate = true;
    t.geometry.attributes.warp.needsUpdate = true;
  }
  t.setTexture = function(texture) {
    t.material.uniforms.diffuse.value = texture
  }
  t.setMask = function(texture) {
    t.material.uniforms.mask.value = texture
  }
  return t
}

// HITMAP

function HitMap(imageData, width) {
  if(imageData) this.setImageData.apply(this, arguments)
}

HitMap.prototype.imageData = null // @see setImageData
HitMap.prototype.width = 0 // @see setImageData
HitMap.prototype.height = 0 // calculated
HitMap.prototype.threshold = 0x80
HitMap.prototype.map = {} // [x][y] { 0: { 0: true, 1: ...}, 1: ...}
HitMap.prototype.pickable = [] // [ {x: 12, y: 14}, ... ]

HitMap.prototype.resetImageData = function() {
  this.imageData = null
  this.width = 0
  this.height = 0
  this.map = {}
  this.pickable = []
}

HitMap.prototype.generateMap = function() {
  this.map = {}
  var x, y, gteThreshold
  for (x = 0; x < this.width; x++) {
    this.map[x] = {}
    for (y = 0; y < this.height; y++) {
      gteThreshold = this.imageData[y*this.width*this.components+x*this.components] >= this.threshold
      this.map[x][y] = gteThreshold
      if (gteThreshold) this.pickable.push({ x: x, y: y })
    }
  }
}

/** @param imageData Uint8Array 8bit per pixel */
HitMap.prototype.setImageData = function(imageData, width, components) {
  this.resetImageData()
  if (!imageData.length) return
  this.components = components || 4
  var len = imageData.length / this.components
  this.imageData = imageData
  this.width = width || Math.sqrt(len) | 0
  this.height = (len / this.width) | 0
  this.generateMap()
}

HitMap.prototype.setThreshold = function(value) {
  if(this.threshold == value) return
  this.threshold = value
  this.generateMap()
}

HitMap.prototype.probe = function(x, y) {
  return this.map[x] && this.map[x][y]
}

HitMap.prototype.pickRandom = function() {
  if (!this.pickable.length) return null
  return this.pickable[(Math.random() * this.pickable.length) | 0]
}


function Overlay(hitMap) {
  this.type = 'Overlay'
  this.stageHitMap = hitMap
  THREE.Group.apply(this, arguments)
  this.loadTexture()
}

Overlay.prototype = Object.create(THREE.Object3D.prototype)
Overlay.prototype.constructor = Overlay
Overlay.prototype.birthday = null
Overlay.prototype.texturePath = '../../assets/something.png'
Overlay.prototype.nativeWidth = 1
Overlay.prototype.nativeHeight = 1
Overlay.prototype.stageWidth = 1
Overlay.prototype.stageHeight = 1

Overlay.prototype.textureScale = 1.

Overlay.prototype.setTexture = function(texture) {
  //console.log(texture)
  this.nativeWidth = texture.image.width
  this.nativeHeight = texture.image.height
  var geometry = new THREE.PlaneBufferGeometry( texture.image.width*this.textureScale, texture.image.height*this.textureScale, 1, 1 );
  var material = new THREE.MeshBasicMaterial(
    {
      //color: Math.random()*0xffffff,
      side: THREE.DoubleSide,
      map: texture,
      opacity: 1.,//0.5+Math.random()*.5,
      transparent: true
    }
  );
  var plane = new THREE.Mesh( geometry, material );
  this.add( plane );
  this.updateScale()
}

Overlay.prototype.setSize = function(width, height) {

  this.stageWidth = width
  this.stageHeight = height
  this.position.x = width/2
  this.position.y = height/2
  this.updateScale()
}

Overlay.prototype.updateScale = function() {
  var prop = this.stageWidth/this.nativeWidth || 1
  this.scale.x = this.scale.y = this.scale.z = prop *.6
}

Overlay.prototype.loadTexture = function() {
  var loader = new THREE.TextureLoader()
  var t = this
  loader.load(
    path.join(__dirname, this.texturePath),
    function ( texture ) {
      t.setTexture(texture)
      //complete()
    },
    function ( xhr ) {
      console.log( (xhr.loaded / xhr.total * 100) + '% loaded' )
    },
    function ( xhr ) {
      console.log( 'An error happened' )
    }
  )
}


// CREATURE

function Creature(hitMap) {
  this.type = 'Creature'
  this.stageHitMap = hitMap
  THREE.Group.apply(this, arguments)
  this.birthday = Date.now()
  this.target = null;
  this.loadTexture()
  this.randomizeScale()
  this.randomizeTarget()
  this.randomizeParams()
  this.randomizePosition()
}

Creature.prototype = Object.create(THREE.Object3D.prototype)
Creature.prototype.constructor = Creature
Creature.prototype.birthday = null
Creature.prototype.targetTime = 0
Creature.prototype.maxTargetTime = 10000
Creature.prototype.texturePath = '../../assets/crusty.png'

Creature.prototype.textureScale = 1.0
Creature.prototype.direction = 0 // radians

Creature.prototype.speed = 0 // units per tick
Creature.prototype.maxSpeed = .2 // units per tick

Creature.prototype.turnSpeed = 0 // radians per tick (-1 to 1)
Creature.prototype.maxTurnSpeed = .003// radians  per tick

Creature.prototype.speedCollisionDamping = .9
Creature.prototype.turnSpeedCollisionDamping = .9

Creature.prototype.rotateAroundVector = new THREE.Vector2()

Creature.prototype.loadTexture = function() {
  var loader = new THREE.TextureLoader()
  var t = this
  loader.load(
    path.join(__dirname, this.texturePath),
    function ( texture ) {
      t.setTexture(texture)
      //complete()
    },
    function ( xhr ) {
      console.log( (xhr.loaded / xhr.total * 100) + '% loaded' )
    },
    function ( xhr ) {
      console.log( 'An error happened' )
    }
  )
}

Creature.prototype.setTexture = function(texture) {
  //console.log(texture)
  var geometry = new THREE.PlaneBufferGeometry( texture.image.width*this.textureScale, texture.image.height*this.textureScale, 1, 1 );
  var material = new THREE.MeshBasicMaterial(
    {
      //color: Math.random()*0xffffff,
      side: THREE.DoubleSide,
      map: texture,
      opacity: 1.,
      transparent: true
    }
  );
  var plane = new THREE.Mesh( geometry, material );
  this.add( plane );
}

/**
* @param HitMap
*/
Creature.prototype.setStageHitMap = function(hitMap) {
  this.stageHitMap = hitMap
}
/**
* @param target vec2 position
*/
Creature.prototype.getValidTarget = function(target) {
  if (!this.stageHitMap) return target // no hitmap, return target
  if (this.stageHitMap.probe(
      target.x | 0,
      target.y | 0
    ) // target is accessible, return it
  ) return target
  var pos = new THREE.Vector2(this.position.x , this.position.y)
  var len = pos.distanceTo(target) | 0
  var lerped
  for (var i = 0; i<len; i++) {
    // go reverse from target
    lerped = new THREE.Vector2().lerpVectors(target, pos, i/len)
    // return lerped whren accessible
    if( this.stageHitMap.probe(lerped.x | 0, lerped.y | 0) ) return lerped
  }
  return pos // if nothing works return position
}


Creature.prototype.calculateTarget = function() {
  var target = new THREE.Vector2(this.speed,0)
  target.rotateAround( this.rotateAroundVector, this.direction )
  target.add(this.position)
  return target
}

Creature.prototype.randomizeParams = function() {
  this.speed = Math.random() * this.maxSpeed
  this.direction = Math.random() * 2 * Math.PI - Math.PI
}

Creature.prototype.randomizeScale = function() {
  this.scale.x = this.scale.y = this.scale.z = .1+ Math.random()* .1
}

Creature.prototype.randomizeTarget = function() {
  var randomPos
  //console.log("randomizeTarget")
  if(this.stageHitMap) randomPos = this.stageHitMap.pickRandom()
  if(!randomPos) randomPos = {x:0, y:0}
  this.target = new THREE.Vector2(randomPos.x, randomPos.y)
  this.targetTime = Date.now()
}

Creature.prototype.randomizePosition = function() {
  if (!this.stageHitMap) {
    this.position.x = 0
    this.position.y = 0
  } else {
    var randomPosition = this.stageHitMap.pickRandom()
    this.position.x = randomPosition.x
    this.position.y = randomPosition.y
  }
}

Creature.prototype.update = function() {
  var targetDistance = new THREE.Vector2(this.position.x, this.position.y).distanceTo(this.target)
  if(targetDistance < 64 || this.targetTime + this.maxTargetTime <= Date.now()) this.randomizeTarget()
  var angle = Math.atan2(this.target.y - this.position.y, this.target.x - this.position.x ) // works
  var a = ((angle) - (this.direction)) % (Math.PI*2)
  var b = ((this.direction) - (angle)) % (Math.PI*2)
  var signedDelta = (a < b)?-a:b
  var aspeed = (Math.abs(signedDelta)<this.maxTurnSpeed) ?Math.abs(signedDelta) : this.maxTurnSpeed
  var angularVelocity = (signedDelta<0 )?-aspeed:aspeed 
  this.direction += angularVelocity
  var velocity = Math.min(this.maxSpeed, targetDistance)
  this.speed = velocity


  var target = this.calculateTarget()
  var validTarget = this.getValidTarget(target)
  if(target.x != validTarget.x && target.y != validTarget.y) {
    // collision happened, just turn
    this.speed = 0
    //

  }
  if (
    this.stageHitMap && !this.stageHitMap.probe(
      validTarget.x | 0,
      validTarget.y | 0
    )
  ) {
    //this.mode = "crawl"
    this.randomizePosition()
    this.randomizeTarget()
  } else {

    this.position.x = validTarget.x
    this.position.y = validTarget.y
    this.rotation.z = this.direction-Math.PI/2
  }
}

function makeRandomCreature(hitMap) {
  var t = new Creature(hitMap)


  return t
}

function makeStage(width, height) {
  var t = {}
  t.creatureCount = 256

  t.width = width || 512
  t.height = height || 512

  t.hitMap = new HitMap()

  t.buffer = new THREE.WebGLRenderTarget(
      t.width, t.height,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter}
  )

  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(0, t.width, t.height , 0, 1, 100)
  t.camera.position.z = 10
  t.creatures = new THREE.Object3D()
  t.scene.add(t.creatures)

  //t.overlay = new Overlay()
  //t.overlay.position.z = 5
  //t.scene.add(t.overlay)

  t.setSize = function(width, height) {
    t.width = width || 512
    t.height = height || 512
    t.camera.left = 0
    t.camera.right = t.width
    t.camera.top = t.height
    t.camera.bottom = 0
    //t.overlay.setSize(t.width, t.height)
    t.camera.updateProjectionMatrix()
    t.buffer.setSize(t.width, t.height)
  }

  t.init = function() {
    for (var i = 0; i<t.creatureCount; i++) {
      var creature = makeRandomCreature(t.hitMap)
      creature.setStageHitMap(this.hitMap)
      t.creatures.add(creature)
    }
  }

  t.update = function() {
    for (var i = 0; i<t.creatures.children.length; i++) {
      var creature = t.creatures.children[i]
      creature.update()
    }
  }
  return t
}


function makeMask(width, height) {
  var t = {}
  t.width = width || 512
  t.height = height || 512
  t.points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1)
  ]

  t.buffer = new THREE.WebGLRenderTarget(
      t.width, t.height,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter}
  )

  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(0, t.width, t.height, 0, 1, 100)
  t.camera.position.z = 10;
  t.camera.updateProjectionMatrix()
  t.hasChanged = false
  t.material = new THREE.MeshBasicMaterial( { color: 0xFFFF00 } )

  t.shapes = new THREE.Object3D()
  t.scene.add(t.shapes)

  t.setSize = function(width, height) {
    if(t.width == width && t.height == height) return
    t.width = width || 512
    t.height = height || 512
    t.camera.left = 0
    t.camera.right = t.width
    t.camera.top = t.height
    t.camera.bottom = 0
    t.camera.updateProjectionMatrix()
    t.buffer.setSize(t.width, t.height)
    t.updatePoints()
  }

  t.removeAll = function() {
    for(var i = 0; i < t.shapes.children.length; i++) {
        t.shapes.remove(t.shapes.children[i])
    }
  }

  t.updatePoints = function() {
    t.removeAll()
    if(t.points.length < 3) return
    var shape = new THREE.Shape()
    shape.moveTo((t.points[t.points.length-1].x)*t.width, (t.points[t.points.length-1].y)*t.height)
    for (var i = 0; i<t.points.length; i++) {
      shape.lineTo((t.points[i].x)*t.width, (t.points[i].y)*t.height)
    }
    var geometry = new THREE.ShapeGeometry(shape)

    t.mesh = new THREE.Mesh( geometry, t.material )
    t.shapes.add(t.mesh)
    t.hasChanged = true
  }
  t.updatePoints()
  return t
}

function makeInstallation(selector, infoSelector) {
  var t = {}
  t.selector = selector || "body"
  t.infoSelector = infoSelector
  t.selected = 0
  t.selectedMaskPoint = 0
  t.maskMode = false
  t.paused = false
  t.showMarkers = true

  t.onResize = function() {
    t.width = window.innerWidth
    t.height = window.innerHeight
    t.stage.setSize(t.width, t.height)
    t.mask.setSize(t.width, t.height)
    t.renderer.setSize(t.width, t.height)
    t.quad.setSize(t.width, t.height)
  }


  t.init = function() {
    t.width = window.innerWidth
    t.height = window.innerHeight
    t.quad = makeQuad() // Projection Mapping Quad
     //t.bl, t.br, t.tr, t.tl
    t.points = [
      t.quad.bl,
      t.quad.br,
      t.quad.tr,
      t.quad.tl,
    ]
    t.mask = makeMask(t.width,t.height) // Mask
    t.stage = makeStage(t.width,t.height) // Simulation

    t.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    t.renderer.setClearColor( 0x000000, 1. )
    t.renderer.setSize(t.width, t.height)
    t.renderer.setPixelRatio(window.devicePixelRatio)

    t.container = document.querySelector(t.selector)
    t.container.appendChild(t.renderer.domElement)

    t.info = document.querySelector(t.infoSelector)

    window.addEventListener('resize', t.onResize, false )
    window.addEventListener('keydown', t.onKeyDown, false )

    t.onResize()
    t.renderMask()
    t.stage.init()
    t.quad.setTexture(t.stage.buffer.texture)
    t.quad.setMask(t.mask.buffer.texture)

    t.loop()
  }

  t.update = function() {
    t.stage.update()
  }

  t.renderMask = function() {
      t.renderer.render(t.mask.scene, t.mask.camera, t.mask.buffer)
      t.maskBitmap = new Uint8Array(t.width*t.height*4)
      t.renderer.readRenderTargetPixels(t.mask.buffer, 0,0, t.width, t.height, t.maskBitmap)
      t.stage.hitMap.setImageData(t.maskBitmap, t.width)
      t.mask.hasChanged = false
  }

  t.render = function() {
    if (t.mask.hasChanged) t.renderMask()
    t.renderer.render(t.stage.scene, t.stage.camera, this.stage.buffer)
    t.renderer.render(t.quad.scene, t.quad.camera)
  }

  t.loop = function () {
    requestAnimationFrame(t.loop)
    if(t.paused) return
    t.update()
    t.render()

  }

  t.onKeyDown = function(e) {
    //console.log(e)
    switch(e.key) {
      case "?":
        t.toggleInfo()
      break
      case " ":
        t.togglePause()
      break
      case "m":
        t.toggleMaskMode()
      break;
      case "o":
        t.quad.material.uniforms.showMasked.value = t.quad.material.uniforms.showMasked.value?0:1
      break;
      case "i":
        t.insertPoint()
      break;
      case "I":
        t.insertPoint(true)
      break;
      case "r":
        t.removePoint()
      break;
      case "PageUp":
        t.prevPoint()
      break;
      case "PageDown":
        t.nextPoint()
      break;
      case "ArrowDown":
        t.decrementY((e.shiftKey)?.1:.001)
      break;
      case "ArrowUp":
        t.incrementY((e.shiftKey)?.1:.001)
      break;
      case "ArrowLeft":
        t.decrementX((e.shiftKey)?.1:.001)
      break;
      case "ArrowRight":
        t.incrementX((e.shiftKey)?.1:.001)
      break;
    }
    t.render()
  }

  t.getPoint = function() {
    if (t.maskMode) return {data: t.mask.points[t.selectedMaskPoint], update:t.mask.updatePoints}
    return {data: t.points[t.selected], update: t.quad.updatePoints}
  }

  t.toggleMaskMode = function() {
    t.maskMode = !t.maskMode
  }

  t.toggleInfo = function() {
    t.info.style.display = t.info.style.display === 'none' ? '' : 'none';
  }

  t.togglePause = function() {
    t.paused = !t.paused
  }

  t.insertPoint = function(prepend) {
    if (t.maskMode) {
      if(prepend) t.prevPoint()
      var pt = t.mask.points[t.selectedMaskPoint]
      t.nextPoint()
      var pt2 = t.mask.points[t.selectedMaskPoint]
      t.mask.points.splice(
        t.selectedMaskPoint,
        0,
        new THREE.Vector2().lerpVectors(pt, pt2, .5)
      )
      t.mask.updatePoints()
    }
  }

  t.removePoint = function() {
    if (t.maskMode && t.mask.points.length > 3) {
      t.mask.points.splice(t.selectedMaskPoint, 1)
      t.selectedMaskPoint = (t.selectedMaskPoint+t.mask.points.length)%t.mask.points.length
      t.mask.updatePoints()
    }
  }

  t.nextPoint = function() {
    if (t.maskMode) t.selectedMaskPoint = (t.selectedMaskPoint+1)%t.mask.points.length
    else t.selected = (t.selected+1)%t.mask.points.length
  }

  t.prevPoint = function() {
    if (t.maskMode) t.selectedMaskPoint = (t.selectedMaskPoint-1+t.mask.points.length)%t.mask.points.length
    else t.selected = (t.selected-1+t.points.length)%t.points.length
  }


  t.incrementX = function(val){
    var pt = t.getPoint()
    pt.data.x += val
    pt.update()
  }

  t.incrementY = function(val){
    var pt = t.getPoint()
    pt.data.y += val
    pt.update()
  }

  t.decrementX = function(val){
    var pt = t.getPoint()
    pt.data.x -= val
    pt.update()
  }

  t.decrementY = function(val){
    var pt = t.getPoint()
    pt.data.y -= val
    pt.update()
  }

  return t
}

var installation = makeInstallation("#screen", "#info")
installation.init()
