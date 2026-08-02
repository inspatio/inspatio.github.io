// Copyright (c) 2026 Inspatio. All rights reserved.
//
// This software and its associated documentation are proprietary to Inspatio.
// Unauthorized copying, modification, distribution, or use is prohibited
// without prior written permission from Inspatio.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const gallery = document.querySelector("#gs-gallery");

if (gallery) {
  const sceneStrip = gallery.querySelector(".gallery-scene-strip");
  const inputStrip = gallery.querySelector(".gallery-input-strip");
  const viewerElement = gallery.querySelector(".gallery-viewer");
  const loadingProgress = gallery.querySelector(".gallery-loading-progress");
  const status = gallery.querySelector(".gallery-status");
  const ttoToggle = gallery.querySelector("#gallery-tto-toggle");
  const fullscreenButton = gallery.querySelector(".gallery-fullscreen-button");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  const spark = new SparkRenderer({ renderer });
  let activeScene;
  let activeSplat;
  let loadToken = 0;

  scene.add(spark);
  renderer.setClearColor(0x9ca3af, 1);
  camera.position.set(0, 0, 3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomSpeed = 1.75;
  controls.panSpeed = 1.2;
  controls.rotateSpeed = -1;
  controls.target.set(0, 0, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewerElement.appendChild(renderer.domElement);

  function resizeViewer() {
    const { width, height } = viewerElement.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  new ResizeObserver(resizeViewer).observe(viewerElement);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  function showLoadingProgress(message) {
    loadingProgress.textContent = message;
    loadingProgress.hidden = false;
  }

  function hideLoadingProgress() {
    loadingProgress.hidden = true;
  }

  function updateLoadingProgress(event, token) {
    if (token !== loadToken) return;
    const { loaded, total, lengthComputable } = event;
    if (lengthComputable && Number.isFinite(total) && total > 0) {
      const percentage = Math.min(100, Math.floor((loaded / total) * 100));
      showLoadingProgress(`Loading 3DGS ${percentage}%`);
    } else {
      showLoadingProgress("Loading 3DGS...");
    }
  }

  function showInputs(sceneData) {
    inputStrip.replaceChildren(...sceneData.inputs.map((source, index) => {
      const image = document.createElement("img");
      image.src = source;
      image.alt = `${sceneData.label} input view ${index + 1}`;
      image.loading = "lazy";
      return image;
    }));
  }

  function sceneCentroid(splat) {
    const values = activeScene?.centroid;
    if (Array.isArray(values) && values.length === 3 && values.every(Number.isFinite)) {
      return new THREE.Vector3(...values);
    }
    return splat.getBoundingBox().getCenter(new THREE.Vector3());
  }

  function frameSplat(splat) {
    const bounds = splat.getBoundingBox();
    const center = sceneCentroid(splat);
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.1);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(center).add(new THREE.Vector3(distance * 0.7, distance * 0.35, distance));
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = Math.max(radius * 100, 100);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  function frameFromInputCamera(splat, cameraData) {
    const c2w = cameraData?.frames?.[0]?.c2w;
    if (!Array.isArray(c2w) || c2w.length !== 4 || c2w.some((row) => !Array.isArray(row) || row.length !== 4)) {
      return false;
    }

    const position = new THREE.Vector3(c2w[0][3], c2w[1][3], c2w[2][3]);
    const up = new THREE.Vector3(-c2w[0][1], -c2w[1][1], -c2w[2][1]).normalize();
    const target = sceneCentroid(splat);

    if (!Number.isFinite(target.lengthSq())) return false;
    camera.position.copy(position);
    camera.up.copy(up);
    const viewDistance = position.distanceTo(target);
    if (viewDistance < 0.001) return false;
    camera.lookAt(target);
    camera.near = Math.max(viewDistance / 1000, 0.001);
    camera.far = Math.max(viewDistance * 100, 100);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
    return true;
  }

  async function loadSplat() {
    if (!activeScene) return;
    const token = ++loadToken;
    const url = ttoToggle.checked ? activeScene.tto : activeScene.noTto;
    if (activeSplat) {
      scene.remove(activeSplat);
      activeSplat.dispose?.();
      activeSplat = undefined;
    }
    setStatus(`Loading ${ttoToggle.checked ? "TTO-refined" : "baseline"} 3D Gaussians...`);
    showLoadingProgress("Loading 3DGS 0%");
    try {
      const [splat, cameraData] = await Promise.all([
        new SplatMesh({
          url,
          onProgress: (event) => updateLoadingProgress(event, token),
        }),
        fetch(activeScene.cameras).then((response) => response.ok ? response.json() : null).catch(() => null),
      ]);
      await splat.initialized;
      if (token !== loadToken) {
        splat.dispose?.();
        return;
      }
      activeSplat = splat;
      scene.add(splat);
      if (!frameFromInputCamera(splat, cameraData)) frameSplat(splat);
      setStatus(ttoToggle.checked ? "TTO-refined 3DGS" : "3DGS without TTO");
      hideLoadingProgress();
    } catch (error) {
      if (token !== loadToken) return;
      console.error("Unable to load Gaussian scene", error);
      hideLoadingProgress();
      setStatus("Unable to load this 3DGS model. Check the browser console.", true);
    }
  }

  function selectScene(sceneData, button) {
    activeScene = sceneData;
    ttoToggle.checked = true;
    sceneStrip.querySelectorAll(".gallery-scene-card").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    showInputs(sceneData);
    loadSplat();
  }

  function buildSceneStrip(scenes) {
    const cards = scenes.map((sceneData) => {
      const button = document.createElement("button");
      button.className = "gallery-scene-card";
      button.type = "button";
      button.innerHTML = `<img src="${sceneData.gif}" alt="${sceneData.label} render preview"><span>${sceneData.label}</span>`;
      button.addEventListener("click", () => selectScene(sceneData, button));
      return button;
    });
    sceneStrip.replaceChildren(...cards);
    if (cards.length) selectScene(scenes[0], cards[0]);
  }

  viewerElement.addEventListener("dblclick", (event) => {
    if (!activeSplat) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    let hit;
    try {
      hit = raycaster.intersectObject(activeSplat, false)[0];
    } catch (error) {
      console.debug("Splat raycast unavailable; using the scene bounds.", error);
    }
    const point = hit?.point || raycaster.ray.intersectBox(activeSplat.getBoundingBox(), new THREE.Vector3());
    if (point) {
      controls.target.copy(point);
      controls.update();
      setStatus("Rotation center updated");
    }
  });

  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      gallery.querySelector(".gallery-viewer-shell").requestFullscreen?.();
    }
  });

  ttoToggle.addEventListener("change", loadSplat);
  fetch("static/gs/scenes.json")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(({ scenes }) => {
      if (!scenes.length) throw new Error("No completed scenes");
      buildSceneStrip(scenes);
    })
    .catch((error) => {
      console.error("Unable to load Gallery manifest", error);
      setStatus("No completed Gallery scenes are available yet.", true);
    });
}
